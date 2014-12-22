/**
 * Copyright 2014, Yahoo! Inc.
 * Copyrights licensed under the New BSD License. See the accompanying LICENSE file for terms.
 */
/*globals describe,it,beforeEach */
"use strict";

var expect = require('chai').expect,
    StorageLRU = require('../../src/StorageLRU'),
    asyncify = require('../../src/asyncify'),
    StorageMock =require('../mocks/StorageMock'),
    generateItems = require('../mocks/generateItems');

function findMetaRecord(records, key) {
    var record;
    for (var i = 0, len = records.length; i < len; i++) {
        if (records[i].key === key) {
            record = records[i];
        }
    }
    return record;
}

describe('StorageLRU', function () {
    var storage;

    beforeEach(function () {
        var mockData = generateItems('TEST_', [
            {
                key: 'fresh-lastAccessed',
                expiresDelta: 60,
                stale: 0,
                accessDelta: -30,
                value: 'expires in 1min, stale=0, last accessed 30secs ago'
            },
            {
                key: 'fresh',
                expiresDelta: 60,
                stale: 0,
                accessDelta: -300,
                value: 'expires in 1min, stale=0, last accessed 5mins ago'
            },
            {
                key: 'fresh-lastAccessed-biggerrecord',
                expiresDelta: 60,
                stale: 0,
                accessDelta: -30,
                value: 'expires in 1min, stale=0, last accessed 30secs ago, blahblahblah'
            },
            {
                key: 'stale-lowpriority',
                expiresDelta: -60,
                stale: 300,
                accessDelta: -600,
                priority: 5,
                value: 'expired 1min ago, stale=5, last accessed 10mins ago, priority=5'
            },
            {
                key: 'stale',
                expiresDelta: -60,
                stale: 300,
                accessDelta: -600,
                value: 'expired 1min ago, stale=5, last accessed 10mins ago'
            },
            {
                key: 'trulyStale',
                expiresDelta: -60,
                stale: 0,
                accessDelta: -30,
                value: 'expired 1min ago, stale=0, last accessed 30secs ago'
            },
            {
                key: 'bad',
                bad: true,
                value: 'invalid format'
            },
            {
                key: 'empty',
                value: ''
            }
        ]);
        storage = asyncify(new StorageMock(mockData));
    });

    it('constructor', function (done) {
        function testCallback (err, lru) {
            expect(lru._storage === storage).to.equal(true, '_storage assigned');
            expect(lru.options.recheckDelay).to.equal(-1, 'options.recheckDelay');
            expect(lru.options.keyPrefix).to.equal('TEST_', 'options.keyPrefix');
            expect(lru._purgeComparator).to.be.a('function', '_purgeComparator assigned');
            done();
        }
        new StorageLRU(storage, {keyPrefix: 'TEST_', onInit: testCallback});
    });

    it('stats', function (done) {
        function testCallback (err, lru) {
            var stats = lru.stats();
            expect(stats).to.eql({hit: 0, miss: 0, stale: 0, error: 0, revalidateSuccess: 0, revalidateFailure: 0}, 'stats inited');
            stats = lru.stats({du: true});
            expect(stats.hit).to.eql(0, 'stats.hit');
            expect(stats.miss).to.eql(0, 'stats.miss');
            expect(stats.stale).to.eql(0, 'stats.stale');
            expect(stats.error).to.eql(0, 'stats.error');
            expect(stats.error).to.eql(0, 'stats.revalidateSuccess');
            expect(stats.error).to.eql(0, 'stats.revalidateFailure');
            expect(stats.du.count).to.eql(8, 'stats.du.count');
            expect(stats.du.size > 0).to.eql(true, 'stats.du.size');
            done();
        }
        new StorageLRU(storage, {keyPrefix: 'TEST_', onInit: testCallback});
    });

    it('get keys', function (done) {
        function testCallback (err, lru) {
            lru.keys(10, function (err, keys) {
                expect(keys[0]).to.equal('TEST_fresh-lastAccessed', 'first key');
                expect(keys[1]).to.equal('TEST_fresh', 'second key');
                done();
            });
        }
        new StorageLRU(storage, {keyPrefix: 'TEST_', onInit: testCallback});
        
    });

    it('numItems', function (done) {
        function testCallback (err, lru) {
            expect(lru._meta.numRecords()).to.equal(8);
            done();
        }
        new StorageLRU(storage, {keyPrefix: 'TEST_', onInit: testCallback});
        
    });

    it('_parseCacheControl', function (done) {
        function testCallback (err, lru) {
            var cc = lru._parseCacheControl('max-age=300,stale-while-revalidate=60');
            expect(cc['max-age']).to.equal(300);
            expect(cc['stale-while-revalidate']).to.equal(60);
            cc = lru._parseCacheControl('no-cache,no-store');
            expect(cc['no-cache']).to.equal(true);
            expect(cc['no-store']).to.equal(true);
            cc = lru._parseCacheControl('');
            expect(cc).to.eql({});
            done();
        }
        new StorageLRU(storage, {keyPrefix: 'TEST_', onInit: testCallback});
    });

    describe('#getItem', function () {
        it('invalid key', function (done) {
            function testCallback (err, lru) {
                lru.getItem('', {}, function (err, value) {
                    expect(err.code).to.equal(5, 'expect "invalid key" error');
                    done();
                });
            }
            new StorageLRU(storage, {keyPrefix: 'TEST_', onInit: testCallback});
        });
        it('cache miss - key does not exist', function (done) {
            function testCallback (err, lru) {
                lru.getItem('key_does_not_exist', {}, function(err, value) {
                    expect(lru.stats()).to.include({hit: 0, miss: 1, stale: 0, error: 0}, 'cache miss');
                    done();
                });
            }
            new StorageLRU(storage, {keyPrefix: 'TEST_', onInit: testCallback});
        });
        it('cache miss - truly stale', function (done) {
            function testCallback (err, lru) {
                var size = lru._meta.numRecords();
                lru.getItem('trulyStale', {}, function(err, value) {
                    expect(!err).to.equal(true, 'no error');
                    expect(!value).to.equal(true, 'no value');
                    expect(lru.stats()).to.include({hit: 0, miss: 1, stale: 0, error: 0}, 'cache miss - truly stale');
                    expect(lru._meta.numRecords()).to.equal(size - 1, 'truly stale item removed');
                    done();
                });
            }
            new StorageLRU(storage, {keyPrefix: 'TEST_', onInit: testCallback});
        });
        it('cache hit - meta not yet built', function (done) {
            function testCallback (err, lru) {
                expect(lru._meta.records.length).to.equal(0);
                storage.getItem('TEST_fresh', function(err, value) {
                    var oldMeta = lru._deserialize(value, {}).meta;
                    lru.getItem('fresh', {json: false}, function(err, value, meta) {
                        expect(lru._meta.records.length).to.equal(1);
                        expect(err).to.equal(null);
                        expect(value).to.equal('expires in 1min, stale=0, last accessed 5mins ago');
                        expect(meta.isStale).to.equal(false);
                        expect(lru.stats()).to.include({hit: 1, miss: 0, stale: 0, error: 0}, 'cache hit');
                        // make sure access timestamp is updated
                        storage.getItem('TEST_fresh', function(err, item) {
                            var newMeta = lru._deserialize(item, {}).meta;
                            expect(newMeta.access > oldMeta.access).to.equal(true, 'access ts updated');
                            expect(newMeta.expires).to.equal(oldMeta.expires, 'expires not changed');
                            expect(newMeta.stale).to.equal(oldMeta.stale, 'stale not changed');
                            expect(newMeta.priority).to.equal(oldMeta.priority, 'priority not changed');
                            done();
                        });
                    });
                });
            }
            new StorageLRU(storage, {keyPrefix: 'TEST_', onInit: testCallback, scanSize: 0});
        });
        it('cache hit - fresh', function (done) {
            function testCallback (err, lru) {
                storage.getItem('TEST_fresh', function(err, value) {
                    var oldMeta = lru._deserialize(value, {}).meta;
                    lru.getItem('fresh', {json: false}, function(err, value, meta) {
                        expect(err).to.equal(null);
                        expect(value).to.equal('expires in 1min, stale=0, last accessed 5mins ago');
                        expect(meta.isStale).to.equal(false);
                        expect(lru.stats()).to.include({hit: 1, miss: 0, stale: 0, error: 0}, 'cache hit');
                        // make sure access timestamp is updated
                        storage.getItem('TEST_fresh', function(err, item) {
                            var newMeta = lru._deserialize(item, {}).meta;
                            expect(newMeta.access > oldMeta.access).to.equal(true, 'access ts updated');
                            expect(newMeta.expires).to.equal(oldMeta.expires, 'expires not changed');
                            expect(newMeta.stale).to.equal(oldMeta.stale, 'stale not changed');
                            expect(newMeta.priority).to.equal(oldMeta.priority, 'priority not changed');
                            done();
                        });
                    });
                });
            }
            new StorageLRU(storage, {keyPrefix: 'TEST_', onInit: testCallback});
        });
        it('cache hit - stale', function (done) {
            function testCallback (err, lru) {
                lru.getItem('stale', {json: false}, function(err, value, meta) {
                    expect(err).to.equal(null);
                    expect(meta.isStale).to.equal(true);
                    expect(value).to.equal('expired 1min ago, stale=5, last accessed 10mins ago');
                    expect(lru.stats()).to.include({hit: 1, miss: 0, stale: 1, error: 0}, 'cache hit - stale');
                    done();
                });
            }
            new StorageLRU(storage, {keyPrefix: 'TEST_', onInit: testCallback});
        });
        it('cache hit - stale - revalidate success', function (done) {
            function testCallback (err, lru) {
                var size = lru._meta.numRecords();
                var record = findMetaRecord(lru._meta.records, 'TEST_stale');
                expect(record.key).to.equal('TEST_stale');
                expect(record.size).to.equal(86);
                expect(record.stale).to.equal(300);

                lru.getItem('stale', {json: false}, function(err, value, meta) {
                    expect(!err).to.equal(true, 'no error, but getting: ' + (err && err.message));
                    expect(meta.isStale).to.equal(true);
                    expect(value).to.equal('expired 1min ago, stale=5, last accessed 10mins ago');
                    expect(lru.stats()).to.include({hit: 1, miss: 0, stale: 1, error: 0, revalidateSuccess:1, revalidateFailure: 0}, 'cache hit,stale,revalidateSuccess');

                    var updatedRecord = findMetaRecord(lru._meta.records, 'TEST_stale');
                    expect(updatedRecord.key).to.equal(record.key, 'key remains the same');
                    expect(updatedRecord.size).to.equal(52, 'size is updated');
                    expect(updatedRecord.access).to.be.above(record.access, 'access timestamp is updated');
                    expect(updatedRecord.expires).to.be.above(record.expires, 'expires timestamp is extended');
                    expect(updatedRecord.maxAge).to.equal(record.maxAge, 'maxAge remains the same');
                    expect(updatedRecord.stale).to.equal(record.stale, 'stale window size remains the same');
                    expect(updatedRecord.priority).to.equal(record.priority, 'priority remains the same');
                    done();
                });
            }
            new StorageLRU(storage, {
                keyPrefix: 'TEST_',
                revalidateFn: function (key, callback) {
                    callback(null, 'revalidated value');
                },
                onInit: testCallback
            });
        });
        it('cache hit - stale - revalidate failure', function (done) {
            function testCallback (err, lru) {
                var size = lru._meta.numRecords();
                var record = findMetaRecord(lru._meta.records, 'TEST_stale');
                expect(record.key).to.equal('TEST_stale');
                expect(record.size).to.equal(86);
                expect(record.stale).to.equal(300);

                lru.getItem('stale', {json: false}, function(err, value, meta) {
                    expect(!err).to.equal(true, 'no error, but getting: ' + (err && err.message));
                    expect(meta.isStale).to.equal(true);
                    expect(value).to.equal('expired 1min ago, stale=5, last accessed 10mins ago');
                    expect(lru.stats()).to.include({hit: 1, miss: 0, stale: 1, error: 0, revalidateSuccess:0, revalidateFailure: 1}, 'cache hit,stale,revalidateFailure');

                    var updatedRecord = findMetaRecord(lru._meta.records, 'TEST_stale');
                    expect(updatedRecord.key).to.equal(record.key, 'key remains the same');
                    expect(updatedRecord.size).to.equal(record.size, 'size remains the same');
                    expect(updatedRecord.access).to.be.above(record.access, 'access timestamp is updated');
                    expect(updatedRecord.expires).to.equal(record.expires, 'expires timestamp remains the same');
                    expect(updatedRecord.maxAge).to.equal(record.maxAge, 'maxAge remains the same');
                    expect(updatedRecord.stale).to.equal(record.stale, 'stale window size remains the same');
                    expect(updatedRecord.priority).to.equal(record.priority, 'priority remains the same');
                    done();
                });
            }
            new StorageLRU(storage, {
                keyPrefix: 'TEST_',
                revalidateFn: function (key, callback) {
                    callback('not able to revalidate "' + key + '"');
                },
                onInit: testCallback
            });
        });
        it('bad item', function (done) {
            function testCallback (err, lru) {
                lru.getItem('bad', {json: false}, function(err, value, meta) {
                    expect(err.code).to.equal(2, 'expect "cannot deserialize" error');
                    expect(lru.stats()).to.include({hit: 0, miss: 0, stale: 0, error: 1}, 'cache hit - stale');
                    done();
                });
            }
            new StorageLRU(storage, {keyPrefix: 'TEST_', onInit: testCallback});
            
        });
        it('empty item', function (done) {
            function testCallback (err, lru) {
                lru.getItem('empty', {}, function(err, value) {
                    expect(err.code).to.equal(2, 'expect deserialize error');
                    expect(lru.stats()).to.include({hit: 0, miss: 0, stale: 0, error: 1}, 'cache miss');
                    done();
                });
            }
            new StorageLRU(storage, {keyPrefix: 'TEST_', onInit: testCallback});
        });
    });

    describe('#setItem', function () {
        it('invalid key', function (done) {
            function testCallback (err, lru) {
                var size = lru._meta.numRecords();
                lru.setItem('', {foo: 'bar'}, {json: true, cacheControl: 'max-age=300'}, function (err, value) {
                    expect(err.code).to.equal(5, 'expect "invalid key" error');
                    expect(lru._meta.numRecords()).to.equal(size, 'numItems remains the same');
                    done();
                });
            }
            new StorageLRU(storage, {keyPrefix: 'TEST_', onInit: testCallback});
        });
        it('new item, json=true', function (done) {
            function testCallback (err, lru) {
                var size = lru._meta.numRecords();
                lru.setItem('new_item', {foo: 'bar'}, {json: true, cacheControl: 'max-age=300'}, function (err) {
                    var num = lru._meta.numRecords();
                    expect(num).to.equal(size + 1, 'numItems should increase by 1');
                    var record = findMetaRecord(lru._meta.records, 'TEST_new_item');
                    expect(record.key).to.equal('TEST_new_item');
                    expect(record.size).to.equal(46);
                    expect(record.stale).to.equal(0);
                    lru.getItem('new_item', {}, function (err, value, meta) {
                        expect(value).to.equal('{"foo":"bar"}');
                        expect(meta.isStale).to.equal(false);
                        done();
                    });
                });
            }
            new StorageLRU(storage, {keyPrefix: 'TEST_', onInit: testCallback});
        });
        it('new item, json=false', function (done) {
            function testCallback (err, lru) {
                var size = lru._meta.numRecords();
                lru.setItem('new_item', 'foobar', {json: false, cacheControl: 'max-age=300'}, function (err) {
                    var num = lru._meta.numRecords();
                    expect(num).to.equal(size + 1);
                    lru.getItem('new_item', {json: false}, function (err, value, meta) {
                        expect(value).to.equal('foobar');
                        expect(meta.isStale).to.equal(false);
                        done();
                    });
                });
            }
            new StorageLRU(storage, {keyPrefix: 'TEST_', onInit: testCallback});
        });
        it('new item, json default is false', function (done) {
            function testCallback (err, lru) {
                var size = lru._meta.numRecords();
                lru.setItem('new_item', '{foo:"bar"}', {cacheControl: 'max-age=300'}, function (err) {
                    var num = lru._meta.numRecords();
                    expect(num).to.equal(size + 1);
                    lru.getItem('new_item', {}, function (err, value, meta) {
                        expect(value).to.equal('{foo:"bar"}');
                        expect(meta.isStale).to.equal(false);
                        done();
                    });
                });
            }
            new StorageLRU(storage, {keyPrefix: 'TEST_', onInit: testCallback});
        });
        it('existing item, json=false', function (done) {
            function testCallback (err, lru) {
                var numItems = lru._meta.numRecords();
                var record = findMetaRecord(lru._meta.records, 'TEST_fresh');
                var access = record.access;
                var size = record.size;
                lru.setItem('fresh', 'foobar', {json: false, cacheControl: 'max-age=300'}, function (err) {
                    var num = lru._meta.numRecords();
                    expect(num).to.equal(numItems, 'numItems is correct');
                    var updatedRecord = findMetaRecord(lru._meta.records, 'TEST_fresh');
                    expect(updatedRecord.access > access).to.equal(true, 'access timestamp updated');
                    expect(updatedRecord.size < size).to.equal(true, 'size timestamp updated');
                    lru.getItem('fresh', {json: false}, function (err, value, meta) {
                        expect(value).to.equal('foobar');
                        expect(meta.isStale).to.equal(false);
                        done();
                    });
                });
            }
            new StorageLRU(storage, {keyPrefix: 'TEST_', onInit: testCallback});
        });
        it('disabled', function (done) {
            function testCallback (err, lru) {
                lru._enabled = false;
                lru.setItem('new_item', 'foobar', {json: false, cacheControl: 'max-age=300'}, function (err) {
                    expect(err.code).to.equal(1);
                    done();
                });
            }
            new StorageLRU(storage, {keyPrefix: 'TEST_', onInit: testCallback});
        });
        it('no-cache', function (done) {
            function testCallback (err, lru) {
                lru.setItem('new_item', 'foobar', {json: false, cacheControl: 'no-cache'}, function (err) {
                    expect(err.code).to.equal(4);
                    done();
                });
            }
            new StorageLRU(storage, {keyPrefix: 'TEST_', onInit: testCallback});
        });
        it('no-store', function (done) {
            function testCallback (err, lru) {
                lru.setItem('new_item', 'foobar', {json: false, cacheControl: 'no-store'}, function (err) {
                    expect(err.code).to.equal(4);
                    done();
                });
            }
            new StorageLRU(storage, {keyPrefix: 'TEST_', onInit: testCallback});
        });
        it('invalid max-age', function (done) {
            function testCallback (err, lru) {
                lru.setItem('new_item', 'foobar', {json: false, cacheControl: 'max-age=-1'}, function (err) {
                    expect(err.code).to.equal(4);
                    done();
                });
            }
            new StorageLRU(storage, {keyPrefix: 'TEST_', onInit: testCallback});
        });
        it('missing cacehControl', function (done) {
            function testCallback (err, lru) {
                lru.setItem('new_item', 'foobar', {json: false}, function (err) {
                    expect(err.code).to.equal(4);
                    done();
                });
            }
            new StorageLRU(storage, {keyPrefix: 'TEST_', onInit: testCallback});
        });
        it('disable mode', function (done) {
            function testCallback (err, lru) {
                lru.setItem('throw_max_quota_error', 'foobar', {json: false, cacheControl: 'max-age=300'}, function (err) {
                    expect(err.code).to.equal(1);
                    done();
                });
            }
            var emptyStorage = asyncify(new StorageMock());
            new StorageLRU(emptyStorage, {keyPrefix: 'TEST_', onInit: testCallback});
        });
        it('disable mode - re-enable', function (done) {
            function testCallback (err, lru) {
                lru.setItem('throw_max_quota_error', 'foobar', {json: false, cacheControl: 'max-age=300'}, function (err, val) {
                    expect(err.code).to.equal(1);
                    setTimeout(function () {
                        expect(lru._enabled).to.equal(true, 'renabled');
                        done();
                    }, 10);
                });
            }
            var emptyStorage = asyncify(new StorageMock());
            new StorageLRU(emptyStorage, {keyPrefix: 'TEST_', recheckDelay: 10, onInit: testCallback});
        });
        it('try purge', function (done) {
            function testCallback (err, lru) {
                lru.setItem('throw_max_quota_error', 'foobarrrrrrr', {json: false, cacheControl: 'max-age=300'}, function (err) {
                    expect(err.code).to.equal(6, 'expected "not enough space" error');
                    done();
                });
            }
            var emptyStorage = asyncify(new StorageMock(generateItems('TEST_', [
                {
                    key: 'fresh',
                    expiresDelta: 60,
                    stale: 0,
                    accessDelta: -300,
                    value: 'foobar'
                }
            ])));
            new StorageLRU(emptyStorage, {keyPrefix: 'TEST_', onInit: testCallback});
        });
    });

    describe('#purge', function () {
        it('all purged spacedNeeded=100000', function (done) {
            function testCallback (err, lru) {
                var size = lru._meta.numRecords();
                lru.purge(10000, false, function (err) {
                    expect(!!err).to.equal(true, 'not enough space');
                    expect(lru._meta.numRecords()).to.equal(0);
                });
            }
            new StorageLRU(storage, {keyPrefix: 'TEST_', purgedFn: function (purged) {
                setTimeout(function () {
                    expect(purged).to.eql(['bad', 'empty', 'trulyStale', 'stale-lowpriority', 'stale', 'fresh', 'fresh-lastAccessed-biggerrecord', 'fresh-lastAccessed']);
                    done();
                }, 1);
            }, onInit: testCallback});
        });
        it('1 purged spacedNeeded=3', function (done) {
            function testCallback (err, lru) {
                var size = lru._meta.numRecords();
                lru.purge(3, false, function (err) {
                    expect(!err).to.eql(true);
                    expect(lru._meta.numRecords()).to.equal(size - 1);
                    done();
                });
            }
            new StorageLRU(storage, {keyPrefix: 'TEST_', purgedFn: function (purged) {
                setTimeout(function () {
                    expect(purged).to.eql(['bad']);
                }, 1);
            }, onInit: testCallback});
        });
        it('2 purged spacedNeeded=50', function (done) {
            function testCallback (err, lru) {
                var size = lru._meta.numRecords();
                lru.purge(50, false, function (err) {
                    expect(!err).to.eql(true);
                    expect(lru._meta.numRecords()).to.equal(size - 3);
                    done();
                });
            }
            new StorageLRU(storage, {keyPrefix: 'TEST_', purgedFn: function (purged) {
                setTimeout(function () {
                    expect(purged).to.eql(['bad', 'trulyStale']);
                }, 1);
            }, onInit: testCallback});
        });
    });

    describe('#_parser.format', function () {
        it('valid meta', function (done) {
            function testCallback (err, lru) {
                var parser = lru._parser;
                expect(parser.format).to.throw('invalid meta');
                var value = parser.format({
                    access: 1000,
                    expires: 1000,
                    maxAge: 300,
                    stale: 0,
                    priority: 4
                }, 'aaa');
                expect(value).to.equal('[1:1000:1000:300:0:4]aaa');
                done();
            }
            new StorageLRU(storage, {keyPrefix: 'TEST_', onInit: testCallback});
        });
        it('negative access', function (done) {
            function testCallback (err, lru) {
                var parser = lru._parser;
                try {
                    parser.format({
                        access: -1,
                        expires: 1000,
                        maxAge: 300,
                        stale: 1000
                    }, 'aaa');
                } catch (e) {
                    expect(e.message).to.equal('invalid meta');
                    done();
                }
            }
            new StorageLRU(storage, {keyPrefix: 'TEST_', onInit: testCallback});
        });
        it('negative stale', function (done) {
            function testCallback (err, lru) {
                var parser = lru._parser;
                try {
                    parser.format({
                        access: 1000,
                        expires: 1000,
                        maxAge: 300,
                        stale: -1
                    }, 'aaa');
                } catch (e) {
                    expect(e.message).to.equal('invalid meta');
                    done();
                }
            }
            new StorageLRU(storage, {keyPrefix: 'TEST_', onInit: testCallback});
        });
        it('negative expires', function (done) {
            function testCallback (err, lru) {
                var parser = lru._parser;
                try {
                    parser.format({
                        access: 1000,
                        expires: -1,
                        maxAge: 300,
                        stale: 0
                    }, 'aaa');
                } catch (e) {
                    expect(e.message).to.equal('invalid meta');
                    done();
                }
            }
            new StorageLRU(storage, {keyPrefix: 'TEST_', onInit: testCallback});
        });
        it('bad priority', function (done) {
            function testCallback (err, lru) {
                var parser = lru._parser;
                try {
                    parser.format({
                        access: 1000,
                        expires: 1000,
                        maxAge: 300,
                        stale: 0,
                        priority: 0
                    }, 'aaa');
                } catch (e) {
                    expect(e.message).to.equal('invalid meta');
                    done();
                }
            }
            new StorageLRU(storage, {keyPrefix: 'TEST_', onInit: testCallback});
        });
    });

    describe('#_parser.parse', function () {
        it('valid format', function (done) {
            function testCallback (err, lru) {
                var parser = lru._parser;
                expect(parser.parse).to.throw('missing meta');
                var parsed = parser.parse('[1:2000:1000:300:0:1]aaa');
                expect(parsed.meta.version).to.equal('1');
                expect(parsed.meta.access).to.equal(2000);
                expect(parsed.meta.expires).to.equal(1000);
                expect(parsed.meta.stale).to.equal(0);
                expect(parsed.meta.priority).to.equal(1);
                expect(parsed.meta.size).to.equal(24);
                expect(parsed.value).to.equal('aaa');
                done();
            }
            new StorageLRU(storage, {keyPrefix: 'TEST_', onInit: testCallback});
        });
        it('negative access field', function (done) {
            function testCallback (err, lru) {
                var parser = lru._parser;
                try {
                    parser.parse('[1:-2000:1000:300:0:1]aaa');
                } catch(e) {
                    expect(e.message).to.equal('invalid meta fields');
                    done();
                }
            }
            new StorageLRU(storage, {keyPrefix: 'TEST_', onInit: testCallback});
        });
    });

    describe('#removeItem', function () {
        it('valid key', function (done) {
            function testCallback (err, lru) {
                var size = lru._meta.numRecords();
                lru.removeItem('fresh', function (err) {
                    expect(!err).to.equal(true, 'expect no error');
                    expect(lru._meta.numRecords()).to.equal(size - 1, 'numItems should decrease by 1');
                    done();
                });
            }
            new StorageLRU(storage, {keyPrefix: 'TEST_', onInit: testCallback});
        });
        it('invalid key', function (done) {
            function testCallback (err, lru) {
                var size = lru._meta.numRecords();
                lru.removeItem('', function (err) {
                    expect(err.code).to.equal(5, 'expect "invalid key" error');
                    expect(lru._meta.numRecords()).to.equal(size, 'numItems should not change');
                    done();
                });
            }
            new StorageLRU(storage, {keyPrefix: 'TEST_', onInit: testCallback});
        });
    });

});
