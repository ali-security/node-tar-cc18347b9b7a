'use strict'

const t = require('tap')
const x = require('../lib/extract.js')
const Pax = require('../lib/pax.js')
const makeTar = require('./make-tar.js')
const path = require('path')
const fs = require('fs')
const extractdir = path.resolve(__dirname, 'fixtures/extract')
const tars = path.resolve(__dirname, 'fixtures/tars')
const mkdirp = require('mkdirp')
const rimraf = require('rimraf')
const mutateFS = require('mutate-fs')

t.teardown(_ => rimraf.sync(extractdir))

t.test('basic extracting', t => {
  const file = path.resolve(tars, 'utf8.tar')
  const dir = path.resolve(extractdir, 'basic')

  t.beforeEach(cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const check = t => {
    fs.lstatSync(dir + '/Ω.txt')
    fs.lstatSync(dir + '/🌟.txt')
    t.throws(_ => fs.lstatSync(dir + '/long-path/r/e/a/l/l/y/-/d/e/e/p/-' +
                               '/f/o/l/d/e/r/-/p/a/t/h/Ω.txt'))

    rimraf.sync(dir)
    t.end()
  }

  const files = [ '🌟.txt', 'Ω.txt' ]
  t.test('sync', t => {
    x({ file: file, sync: true, C: dir }, files)
    check(t)
  })

  t.test('async promisey', t => {
    return x({ file: file, cwd: dir }, files).then(_ => {
      check(t)
    })
  })

  t.test('async cb', t => {
    return x({ file: file, cwd: dir }, files, er => {
      if (er)
        throw er
      check(t)
    })
  })

  t.end()
})

t.test('file list and filter', t => {
  const file = path.resolve(tars, 'utf8.tar')
  const dir = path.resolve(extractdir, 'filter')

  t.beforeEach(cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const check = t => {
    fs.lstatSync(dir + '/Ω.txt')
    t.throws(_ => fs.lstatSync(dir + '/🌟.txt'))
    t.throws(_ => fs.lstatSync(dir + '/long-path/r/e/a/l/l/y/-/d/e/e/p/-' +
                               '/f/o/l/d/e/r/-/p/a/t/h/Ω.txt'))

    rimraf.sync(dir)
    t.end()
  }

  const filter = path => path === 'Ω.txt'

  t.test('sync', t => {
    x({ filter: filter, file: file, sync: true, C: dir }, [ '🌟.txt', 'Ω.txt' ])
    check(t)
  })

  t.test('async promisey', t => {
    return x({ filter: filter, file: file, cwd: dir }, [ '🌟.txt', 'Ω.txt' ]).then(_ => {
      check(t)
    })
  })

  t.test('async cb', t => {
    return x({ filter: filter, file: file, cwd: dir }, [ '🌟.txt', 'Ω.txt' ], er => {
      if (er)
        throw er
      check(t)
    })
  })

  t.end()
})

t.test('no file list', t => {
  const file = path.resolve(tars, 'body-byte-counts.tar')
  const dir = path.resolve(extractdir, 'no-list')

  t.beforeEach(cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const check = t => {
    t.equal(fs.lstatSync(path.resolve(dir, '1024-bytes.txt')).size, 1024)
    t.equal(fs.lstatSync(path.resolve(dir, '512-bytes.txt')).size, 512)
    t.equal(fs.lstatSync(path.resolve(dir, 'one-byte.txt')).size, 1)
    t.equal(fs.lstatSync(path.resolve(dir, 'zero-byte.txt')).size, 0)
    rimraf.sync(dir)
    t.end()
  }

  t.test('sync', t => {
    x({ file: file, sync: true, C: dir })
    check(t)
  })

  t.test('async promisey', t => {
    return x({ file: file, cwd: dir }).then(_ => {
      check(t)
    })
  })

  t.test('async cb', t => {
    return x({ file: file, cwd: dir }, er => {
      if (er)
        throw er
      check(t)
    })
  })

  t.end()
})

t.test('read in itty bits', t => {
  const maxReadSize = 1000
  const file = path.resolve(tars, 'body-byte-counts.tar')
  const dir = path.resolve(extractdir, 'no-list')

  t.beforeEach(cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const check = t => {
    t.equal(fs.lstatSync(path.resolve(dir, '1024-bytes.txt')).size, 1024)
    t.equal(fs.lstatSync(path.resolve(dir, '512-bytes.txt')).size, 512)
    t.equal(fs.lstatSync(path.resolve(dir, 'one-byte.txt')).size, 1)
    t.equal(fs.lstatSync(path.resolve(dir, 'zero-byte.txt')).size, 0)
    rimraf.sync(dir)
    t.end()
  }

  t.test('sync', t => {
    x({ file: file, sync: true, C: dir, maxReadSize: maxReadSize })
    check(t)
  })

  t.test('async promisey', t => {
    return x({ file: file, cwd: dir, maxReadSize: maxReadSize }).then(_ => {
      check(t)
    })
  })

  t.test('async cb', t => {
    return x({ file: file, cwd: dir, maxReadSize: maxReadSize }, er => {
      if (er)
        throw er
      check(t)
    })
  })

  t.end()
})

t.test('bad calls', t => {
  t.throws(_=> x(_=>_))
  t.throws(_=> x({sync: true}, _=>_))
  t.throws(_=> x({sync: true}, [], _=>_))
  t.end()
})

t.test('no file', t => {
  const Unpack = require('../lib/unpack.js')
  t.isa(x(), Unpack)
  t.isa(x(['asdf']), Unpack)
  t.isa(x({sync:true}), Unpack.Sync)
  t.end()
})

t.test('nonexistent', t => {
  t.throws(_ => x({sync: true, file: 'does not exist' }))
  x({ file: 'does not exist' }).catch(_ => t.end())
})

t.test('read fail', t => {
  const poop = new Error('poop')
  t.teardown(mutateFS.fail('read', poop))

  t.throws(_ => x({maxReadSize: 10, sync: true, file: __filename }), poop)
  t.end()
})

t.test('sync gzip error edge case test', t => {
  const zlib = require('minizlib')
  const file = path.resolve(__dirname, 'fixtures/sync-gzip-fail.tgz')
  const dir = path.resolve(__dirname, 'sync-gzip-fail')
  const cwd = process.cwd()
  mkdirp.sync(dir + '/x')
  process.chdir(dir)
  t.teardown(() => {
    process.chdir(cwd)
    rimraf.sync(dir)
  })

  x({
    sync: true,
    file: file,
    onwarn: (m, er) => { throw er }
  })

  t.same(fs.readdirSync(dir + '/x').sort(),
    [ '1', '10', '2', '3', '4', '5', '6', '7', '8', '9' ])

  t.end()
})

// A PAX header entry with a numeric-looking path (e.g. "12345") must be
// extracted as a file named "12345", not crash or skip, in strict and non-strict.
const makePaxExtractData = (paxName, entryName) => {
  const paxHeader = new Pax({ path: paxName, size: '12345\n'.length }, false)
  const paxData = paxHeader.encode()
  return makeTar([
    paxData,
    {
      type: 'File',
      path: entryName,
      mode: 0o755,
      ctime: new Date('2000-01-01T00:00:00.000Z'),
      mtime: new Date('2000-01-01T00:00:00.000Z'),
      size: '12345\n'.length
    },
    '12345\n',
    '',
    ''
  ])
}

const paxNameDir = (which, data) => {
  const dir = path.resolve(extractdir, 'numeric-pax-name-' + which)
  rimraf.sync(dir)
  mkdirp.sync(dir)
  fs.writeFileSync(dir + '/tarFile', data)
  return dir
}

for (const strict of [true, false]) {
  for (const paxName of ['12345', 'abcde']) {
    for (const entryName of ['12345', 'abcde']) {
      const label = 'numeric pax/entry name discernment strict=' + strict +
        ' paxName=' + paxName + ' entryName=' + entryName
      const which = strict + '-' + paxName + '-' + entryName
      const data = makePaxExtractData(paxName, entryName)

      t.test(label + ' sync', t => {
        const dir = paxNameDir(which + '-sync', data)
        t.teardown(_ => rimraf.sync(dir))
        x({ strict: strict, sync: true, cwd: dir, file: dir + '/tarFile' })
        t.equal(fs.readFileSync(dir + '/' + paxName, 'utf8'), '12345\n')
        t.end()
      })

      t.test(label + ' async', t => {
        const dir = paxNameDir(which + '-async', data)
        t.teardown(_ => rimraf.sync(dir))
        x({ strict: strict, cwd: dir, file: dir + '/tarFile' }).then(_ => {
          t.equal(fs.readFileSync(dir + '/' + paxName, 'utf8'), '12345\n')
          t.end()
        })
      })
    }
  }
}
