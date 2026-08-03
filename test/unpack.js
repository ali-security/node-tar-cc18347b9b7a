'use strict'

process.umask(0o022)

const Unpack = require('../lib/unpack.js')
const UnpackSync = Unpack.Sync
const t = require('tap')
const MiniPass = require('minipass')

const makeTar = require('./make-tar.js')
const Pax = require('../lib/pax.js')
const Header = require('../lib/header.js')
const z = require('minizlib')
const fs = require('fs')
const os = require('os')
const path = require('path')
const fixtures = path.resolve(__dirname, 'fixtures')
const files = path.resolve(fixtures, 'files')
const tars = path.resolve(fixtures, 'tars')
const parses = path.resolve(fixtures, 'parse')
const unpackdir = path.resolve(fixtures, 'unpack')
const rimraf = require('rimraf')
const mkdirp = require('mkdirp')
const mutateFS = require('mutate-fs')
const eos = require('end-of-stream')
const ReadEntry = require('../lib/read-entry.js')

t.teardown(_ => rimraf.sync(unpackdir))

t.test('setup', t => {
  rimraf.sync(unpackdir)
  mkdirp.sync(unpackdir)
  t.end()
})

t.test('basic file unpack tests', t => {
  const basedir = path.resolve(unpackdir, 'basic')
  t.teardown(_ => rimraf.sync(basedir))

  const cases = {
    'emptypax.tar': {
      '🌟.txt': '🌟✧✩⭐︎✪✫✬✭✮⚝✯✰✵✶✷✸✹❂⭑⭒★☆✡☪✴︎✦✡️🔯✴️🌠\n',
      'one-byte.txt': 'a'
    },
    'body-byte-counts.tar': {
      '1024-bytes.txt': new Array(1024).join('x') + '\n',
      '512-bytes.txt': new Array(512).join('x') + '\n',
      'one-byte.txt': 'a',
      'zero-byte.txt': ''
    },
    'utf8.tar': {
      '🌟.txt': '🌟✧✩⭐︎✪✫✬✭✮⚝✯✰✵✶✷✸✹❂⭑⭒★☆✡☪✴︎✦✡️🔯✴️🌠\n',
      'Ω.txt': 'Ω',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt': 'Ω'
    },
    'file.tar': {
      'one-byte.txt': 'a'
    },
    'global-header.tar': {
      'one-byte.txt': 'a'
    },
    'long-pax.tar': {
      '120-byte-filename-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
    },
    'long-paths.tar': {
      '100-byte-filename-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      '120-byte-filename-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      '170-byte-filename-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/a.txt': 'short\n',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt': 'Ω'
    }
  }

  const tarfiles = Object.keys(cases)
  t.plan(tarfiles.length)
  t.jobs = tarfiles.length

  tarfiles.forEach(tarfile => {
    t.test(tarfile, t => {
      const tf = path.resolve(tars, tarfile)
      const dir = path.resolve(basedir, tarfile)
      t.beforeEach(cb => {
        rimraf.sync(dir)
        mkdirp.sync(dir)
        cb()
      })

      const check = t => {
        const expect = cases[tarfile]
        Object.keys(expect).forEach(file => {
          const f = path.resolve(dir, file)
          t.equal(fs.readFileSync(f, 'utf8'), expect[file], file)
        })
        t.end()
      }

      t.plan(2)

      t.test('async unpack', t => {
        t.plan(2)
        t.test('strict', t => {
          const unpack = new Unpack({ cwd: dir, strict: true })
          fs.createReadStream(tf).pipe(unpack)
          eos(unpack, _ => check(t))
        })
        t.test('loose', t => {
          const unpack = new Unpack({ cwd: dir })
          fs.createReadStream(tf).pipe(unpack)
          eos(unpack, _ => check(t))
        })
      })

      t.test('sync unpack', t => {
        t.plan(2)
        t.test('strict', t => {
          const unpack = new UnpackSync({ cwd: dir })
          unpack.end(fs.readFileSync(tf))
          check(t)
        })
        t.test('loose', t => {
          const unpack = new UnpackSync({ cwd: dir })
          unpack.end(fs.readFileSync(tf))
          check(t)
        })
      })
    })
  })
})

t.test('cwd default to process cwd', t => {
  const u = new Unpack()
  const us = new UnpackSync()
  const cwd = process.cwd()
  t.equal(u.cwd, cwd)
  t.equal(us.cwd, cwd)
  t.end()
})

t.test('links!', t => {
  const dir = path.resolve(unpackdir, 'links')
  const data = fs.readFileSync(tars + '/links.tar')
  const stripData = fs.readFileSync(tars + '/links-strip.tar')

  t.plan(6)
  t.beforeEach(cb => mkdirp(dir, cb))
  t.afterEach(cb => rimraf(dir, cb))

  const check = t => {
    const hl1 = fs.lstatSync(dir + '/hardlink-1')
    const hl2 = fs.lstatSync(dir + '/hardlink-2')
    t.equal(hl1.dev, hl2.dev)
    t.equal(hl1.ino, hl2.ino)
    t.equal(hl1.nlink, 2)
    t.equal(hl2.nlink, 2)
    const sym = fs.lstatSync(dir + '/symlink')
    t.ok(sym.isSymbolicLink())
    t.equal(fs.readlinkSync(dir + '/symlink'), 'hardlink-2')
    t.end()
  }
  const checkForStrip = t => {
    const hl1 = fs.lstatSync(dir + '/hardlink-1')
    const hl2 = fs.lstatSync(dir + '/hardlink-2')
    const hl3 = fs.lstatSync(dir + '/1/2/3/hardlink-3')
    t.equal(hl1.dev, hl2.dev)
    t.equal(hl1.ino, hl2.ino)
    t.equal(hl1.dev, hl3.dev)
    t.equal(hl1.ino, hl3.ino)
    t.equal(hl1.nlink, 3)
    t.equal(hl2.nlink, 3)
    const sym = fs.lstatSync(dir + '/symlink')
    t.ok(sym.isSymbolicLink())
    t.equal(fs.readlinkSync(dir + '/symlink'), 'hardlink-2')
    t.end()
  }
  const checkForStrip3 = t => {
    t.ok(fs.lstatSync(dir + '/3').isDirectory())
    let err = null
    try {
      fs.lstatSync(dir + '/3/hardlink-3')
    } catch(e) {
      err = e
    }
    // can't be extracted because we've passed it in the tar (specially crafted tar for this not to work)
    t.equal(err.code, 'ENOENT')
    t.end()
  }

  t.test('async', t => {
    const unpack = new Unpack({ cwd: dir })
    let finished = false
    unpack.on('finish', _ => finished = true)
    unpack.on('close', _ => t.ok(finished, 'emitted finish before close'))
    unpack.on('close', _ => check(t))
    unpack.end(data)
  })

  t.test('sync', t => {
    const unpack = new UnpackSync({ cwd: dir })
    unpack.end(data)
    check(t)
  })

  t.test('sync strip', t => {
    const unpack = new UnpackSync({ cwd: dir, strip: 1 })
    unpack.end(fs.readFileSync(tars + '/links-strip.tar'))
    checkForStrip(t)
  })

  t.test('async strip', t => {
    const unpack = new Unpack({ cwd: dir, strip: 1 })
    let finished = false
    unpack.on('finish', _ => finished = true)
    unpack.on('close', _ => t.ok(finished, 'emitted finish before close'))
    unpack.on('close', _ => checkForStrip(t))
    unpack.end(stripData)
  })

  t.test('sync strip 3', t => {
    const unpack = new UnpackSync({ cwd: dir, strip: 3 })
    unpack.end(fs.readFileSync(tars + '/links-strip.tar'))
    checkForStrip3(t)
  })

  t.test('async strip 3', t => {
    const unpack = new Unpack({ cwd: dir, strip: 3 })
    let finished = false
    unpack.on('finish', _ => finished = true)
    unpack.on('close', _ => t.ok(finished, 'emitted finish before close'))
    unpack.on('close', _ => checkForStrip3(t))
    unpack.end(stripData)
  })
})

t.test('links without cleanup (exercise clobbering code)', t => {
  const dir = path.resolve(unpackdir, 'links')
  const data = fs.readFileSync(tars + '/links.tar')

  t.plan(6)
  mkdirp.sync(dir)
  t.teardown(_ => rimraf.sync(dir))

  t.beforeEach(cb => {
    // clobber this junk
    try {
      mkdirp.sync(dir + '/hardlink-1')
      mkdirp.sync(dir + '/hardlink-2')
      fs.writeFileSync(dir + '/symlink', 'not a symlink')
    } catch (er) {}
    cb()
  })

  const check = t => {
    const hl1 = fs.lstatSync(dir + '/hardlink-1')
    const hl2 = fs.lstatSync(dir + '/hardlink-2')
    t.equal(hl1.dev, hl2.dev)
    t.equal(hl1.ino, hl2.ino)
    t.equal(hl1.nlink, 2)
    t.equal(hl2.nlink, 2)
    const sym = fs.lstatSync(dir + '/symlink')
    t.ok(sym.isSymbolicLink())
    t.equal(fs.readlinkSync(dir + '/symlink'), 'hardlink-2')
    t.end()
  }

  t.test('async', t => {
    const unpack = new Unpack({ cwd: dir })
    let prefinished = false
    unpack.on('prefinish', _ => prefinished = true)
    unpack.on('finish', _ =>
      t.ok(prefinished, 'emitted prefinish before finish'))
    unpack.on('close', _ => check(t))
    unpack.end(data)
  })

  t.test('sync', t => {
    const unpack = new UnpackSync({ cwd: dir })
    unpack.end(data)
    check(t)
  })

  t.test('async again', t => {
    const unpack = new Unpack({ cwd: dir })
    eos(unpack, _ => check(t))
    unpack.end(data)
  })

  t.test('sync again', t => {
    const unpack = new UnpackSync({ cwd: dir })
    unpack.end(data)
    check(t)
  })

  t.test('async unlink', t => {
    const unpack = new Unpack({ cwd: dir, unlink: true })
    unpack.on('close', _ => check(t))
    unpack.end(data)
  })

  t.test('sync unlink', t => {
    const unpack = new UnpackSync({ cwd: dir, unlink: true })
    unpack.end(data)
    check(t)
  })
})

t.test('nested dir dupe', t => {
  const dir = path.resolve(unpackdir, 'nested-dir')
  mkdirp.sync(dir + '/d/e/e/p')
  t.teardown(_ => rimraf.sync(dir))
  const expect = {
    'd/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/a.txt': 'short\n',
    'd/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'd/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'd/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'd/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt': 'Ω'
  }

  const check = t => {
    const entries = fs.readdirSync(dir)
    t.equal(entries.length, 1)
    t.equal(entries[0], 'd')
    Object.keys(expect).forEach(f => {
      const file = dir + '/' + f
      t.equal(fs.readFileSync(file, 'utf8'), expect[f])
    })
    t.end()
  }

  const unpack = new Unpack({ cwd: dir, strip: 8 })
  const data = fs.readFileSync(tars + '/long-paths.tar')
  // while we're at it, why not use gzip too?
  const zip = new z.Gzip()
  zip.pipe(unpack)
  unpack.on('close', _ => check(t))
  zip.end(data)
})

t.test('symlink in dir path', t => {
  const dir = path.resolve(unpackdir, 'symlink-junk')

  t.teardown(_ => rimraf.sync(dir))
  t.beforeEach(cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const data = makeTar([
    {
      path: 'd/i',
      type: 'Directory'
    },
    {
      path: 'd/i/r/dir',
      type: 'Directory',
      mode: 0o751,
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    {
      path: 'd/i/r/file',
      type: 'File',
      size: 1,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z')
    },
    'a',
    {
      path: 'd/i/r/link',
      type: 'Link',
      linkpath: 'd/i/r/file',
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    {
      path: 'd/i/r/symlink',
      type: 'SymbolicLink',
      linkpath: './dir',
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    {
      path: 'd/i/r/symlink/x',
      type: 'File',
      size: 0,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    '',
    ''
  ])

  t.test('no clobbering', t => {
    const warnings = []
    const u = new Unpack({ cwd: dir, onwarn: (w,d) => warnings.push([w,d]) })
    u.on('close', _ => {
      t.equal(fs.lstatSync(dir + '/d/i').mode & 0o7777, 0o755)
      t.equal(fs.lstatSync(dir + '/d/i/r/dir').mode & 0o7777, 0o751)
      t.ok(fs.lstatSync(dir + '/d/i/r/file').isFile(), 'got file')
      t.ok(fs.lstatSync(dir + '/d/i/r/symlink').isSymbolicLink(), 'got symlink')
      t.throws(_ => fs.statSync(dir + '/d/i/r/symlink/x'))
      t.equal(warnings.length, 1)
      t.equal(warnings[0][0], 'Cannot extract through symbolic link')
      t.match(warnings[0][1], {
        name: 'SylinkError',
        path: dir + '/d/i/r/symlink/',
        symlink: dir + '/d/i/r/symlink'
      })
      t.end()
    })
    u.end(data)
  })

  t.test('no clobbering, sync', t => {
    const warnings = []
    const u = new UnpackSync({
      cwd: dir,
      onwarn: (w,d) => warnings.push([w,d])
    })
    u.end(data)
    t.equal(fs.lstatSync(dir + '/d/i/r/dir').mode & 0o7777, 0o751)
    t.ok(fs.lstatSync(dir + '/d/i/r/file').isFile(), 'got file')
    t.ok(fs.lstatSync(dir + '/d/i/r/symlink').isSymbolicLink(), 'got symlink')
    t.throws(_ => fs.statSync(dir + '/d/i/r/symlink/x'))
    t.equal(warnings.length, 1)
    t.equal(warnings[0][0], 'Cannot extract through symbolic link')
    t.match(warnings[0][1], {
      name: 'SylinkError',
      path: dir + '/d/i/r/symlink/',
      symlink: dir + '/d/i/r/symlink'
    })
    t.end()
  })

  t.test('extract through symlink', t => {
    const warnings = []
    const u = new Unpack({
      cwd: dir,
      onwarn: (w,d) => warnings.push([w,d]),
      preservePaths: true
    })
    u.on('close', _ => {
      t.same(warnings, [])
      t.equal(fs.lstatSync(dir + '/d/i/r/dir').mode & 0o7777, 0o751)
      t.ok(fs.lstatSync(dir + '/d/i/r/file').isFile(), 'got file')
      t.ok(fs.lstatSync(dir + '/d/i/r/symlink').isSymbolicLink(), 'got symlink')
      t.ok(fs.lstatSync(dir + '/d/i/r/dir/x').isFile(), 'x thru link')
      t.ok(fs.lstatSync(dir + '/d/i/r/symlink/x').isFile(), 'x thru link')
      t.end()
    })
    u.end(data)
  })

  t.test('extract through symlink sync', t => {
    const warnings = []
    const u = new UnpackSync({
      cwd: dir,
      onwarn: (w,d) => warnings.push([w,d]),
      preservePaths: true
    })
    u.end(data)
    t.same(warnings, [])
    t.equal(fs.lstatSync(dir + '/d/i/r/dir').mode & 0o7777, 0o751)
    t.ok(fs.lstatSync(dir + '/d/i/r/file').isFile(), 'got file')
    t.ok(fs.lstatSync(dir + '/d/i/r/symlink').isSymbolicLink(), 'got symlink')
    t.ok(fs.lstatSync(dir + '/d/i/r/dir/x').isFile(), 'x thru link')
    t.ok(fs.lstatSync(dir + '/d/i/r/symlink/x').isFile(), 'x thru link')
    t.end()
  })

  t.test('clobber through symlink', t => {
    const warnings = []
    const u = new Unpack({
      cwd: dir,
      onwarn: (w,d) => warnings.push([w,d]),
      unlink: true
    })
    u.on('close', _ => {
      t.same(warnings, [])
      t.equal(fs.lstatSync(dir + '/d/i/r/dir').mode & 0o7777, 0o751)
      t.ok(fs.lstatSync(dir + '/d/i/r/file').isFile(), 'got file')
      t.notok(fs.lstatSync(dir + '/d/i/r/symlink').isSymbolicLink(), 'no link')
      t.ok(fs.lstatSync(dir + '/d/i/r/symlink').isDirectory(), 'sym is dir')
      t.ok(fs.lstatSync(dir + '/d/i/r/symlink/x').isFile(), 'x thru link')
      t.end()
    })
    u.end(data)
  })

  t.test('clobber through symlink with busted unlink', t => {
    const poop = new Error('poop')
    t.teardown(mutateFS.fail('unlink', poop))
    const warnings = []
    const u = new Unpack({
      cwd: dir,
      onwarn: (w,d) => warnings.push([w,d]),
      unlink: true
    })
    u.on('close', _ => {
      t.same(warnings, [[ 'poop', poop ]])
      t.end()
    })
    u.end(data)
  })

  t.test('clobber through symlink sync', t => {
    const warnings = []
    const u = new UnpackSync({
      cwd: dir,
      onwarn: (w,d) => warnings.push([w,d]),
      unlink: true
    })
    u.end(data)
    t.equal(fs.lstatSync(dir + '/d/i/r/dir').mode & 0o7777, 0o751)
    t.ok(fs.lstatSync(dir + '/d/i/r/file').isFile(), 'got file')
    t.notok(fs.lstatSync(dir + '/d/i/r/symlink').isSymbolicLink(), 'no link')
    t.ok(fs.lstatSync(dir + '/d/i/r/symlink').isDirectory(), 'sym is dir')
    t.ok(fs.lstatSync(dir + '/d/i/r/symlink/x').isFile(), 'x thru link')
    t.end()
  })

  t.test('clobber dirs', t => {
    mkdirp.sync(dir + '/d/i/r/dir')
    mkdirp.sync(dir + '/d/i/r/file')
    mkdirp.sync(dir + '/d/i/r/link')
    mkdirp.sync(dir + '/d/i/r/symlink')
    const warnings = []
    const u = new Unpack({
      cwd: dir,
      onwarn: (w, d) => {
        warnings.push([w,d])
      }
    })
    u.on('close', _ => {
      t.equal(fs.lstatSync(dir + '/d/i/r/dir').mode & 0o7777, 0o751)
      t.ok(fs.lstatSync(dir + '/d/i/r/file').isFile(), 'got file')
      t.ok(fs.lstatSync(dir + '/d/i/r/symlink').isSymbolicLink(), 'got symlink')
      t.throws(_ => fs.statSync(dir + '/d/i/r/symlink/x'))
      t.equal(warnings.length, 1)
      t.equal(warnings[0][0], 'Cannot extract through symbolic link')
      t.match(warnings[0][1], {
        name: 'SylinkError',
        path: dir + '/d/i/r/symlink/',
        symlink: dir + '/d/i/r/symlink'
      })
      t.end()
    })
    u.end(data)
  })

  t.test('clobber dirs sync', t => {
    mkdirp.sync(dir + '/d/i/r/dir')
    mkdirp.sync(dir + '/d/i/r/file')
    mkdirp.sync(dir + '/d/i/r/link')
    mkdirp.sync(dir + '/d/i/r/symlink')
    const warnings = []
    const u = new UnpackSync({
      cwd: dir,
      onwarn: (w, d) => {
        warnings.push([w,d])
      }
    })
    u.end(data)
    t.equal(fs.lstatSync(dir + '/d/i/r/dir').mode & 0o7777, 0o751)
    t.ok(fs.lstatSync(dir + '/d/i/r/file').isFile(), 'got file')
    t.ok(fs.lstatSync(dir + '/d/i/r/symlink').isSymbolicLink(), 'got symlink')
    t.throws(_ => fs.statSync(dir + '/d/i/r/symlink/x'))
    t.equal(warnings.length, 1)
    t.equal(warnings[0][0], 'Cannot extract through symbolic link')
    t.match(warnings[0][1], {
      name: 'SylinkError',
      path: dir + '/d/i/r/symlink/',
      symlink: dir + '/d/i/r/symlink'
    })
    t.end()
  })

  t.end()
})

t.test('unsupported entries', t => {
  const dir = path.resolve(unpackdir, 'unsupported-entries')
  mkdirp.sync(dir)
  t.teardown(_ => rimraf.sync(dir))
  const unknown = new Header({ path: 'qux', type: 'File', size: 4 })
  unknown.type = 'Z'
  unknown.encode()
  const data = makeTar([
    {
      path: 'dev/random',
      type: 'CharacterDevice'
    },
    {
      path: 'dev/hd0',
      type: 'BlockDevice'
    },
    {
      path: 'dev/fifo0',
      type: 'FIFO'
    },
    unknown.block,
    'asdf',
    '',
    ''
  ])

  t.test('basic, warns', t => {
    const warnings = []
    const u = new Unpack({ cwd: dir, onwarn: (w,d) => warnings.push([w,d]) })
    const expect = [
      ['unsupported entry type: CharacterDevice', { path: 'dev/random' }],
      ['unsupported entry type: BlockDevice', { path: 'dev/hd0' }],
      ['unsupported entry type: FIFO', { path: 'dev/fifo0' }]
    ]
    u.on('close', _ => {
      t.equal(fs.readdirSync(dir).length, 0)
      t.match(warnings, expect)
      t.end()
    })
    u.end(data)
  })

  t.test('strict, throws', t => {
    const warnings = []
    const errors = []
    const u = new Unpack({
      cwd: dir,
      strict: true,
      onwarn: (w,d) => warnings.push([w,d])
    })
    u.on('error', e => errors.push(e))
    u.on('close', _ => {
      t.equal(fs.readdirSync(dir).length, 0)
      t.same(warnings, [])
      t.match(errors, [
        {
          message: 'unsupported entry type: CharacterDevice',
          data: { path: 'dev/random' }
        },
        {
          message: 'unsupported entry type: BlockDevice',
          data: { path: 'dev/hd0' }
        },
        {
          message: 'unsupported entry type: FIFO',
          data: { path: 'dev/fifo0' }
        }
      ])
      t.end()
    })
    u.end(data)
  })

  t.end()
})


t.test('file in dir path', t => {
  const dir = path.resolve(unpackdir, 'file-junk')

  t.teardown(_ => rimraf.sync(dir))
  t.beforeEach(cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const data = makeTar([
    {
      path: 'd/i/r/file',
      type: 'File',
      size: 1,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    'a',
    {
      path: 'd/i/r/file/a/b/c',
      type: 'File',
      size: 1,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    'b',
    '',
    ''
  ])

  t.test('fail because of file', t => {
    const check = t => {
      t.equal(fs.readFileSync(dir + '/d/i/r/file', 'utf8'), 'a')
      t.throws(_ => fs.statSync(dir + '/d/i/r/file/a/b/c'))
      t.end()
    }

    t.plan(2)

    t.test('async', t => {
      new Unpack({ cwd: dir }).on('close', _ => check(t)).end(data)
    })

    t.test('sync', t => {
      new UnpackSync({ cwd: dir }).end(data)
      check(t)
    })
  })

  t.test('clobber on through', t => {
    const check = t => {
      t.ok(fs.statSync(dir + '/d/i/r/file').isDirectory())
      t.equal(fs.readFileSync(dir + '/d/i/r/file/a/b/c', 'utf8'), 'b')
      t.end()
    }

    t.plan(2)

    t.test('async', t => {
      new Unpack({ cwd: dir, unlink: true }).on('close', _ => check(t)).end(data)
    })

    t.test('sync', t => {
      new UnpackSync({ cwd: dir, unlink: true }).end(data)
      check(t)
    })
  })

  t.end()
})

t.test('set umask option', t => {
  const dir = path.resolve(unpackdir, 'umask')
  mkdirp.sync(dir)
  t.tearDown(_ => rimraf.sync(dir))

  const data = makeTar([
    {
      path: 'd/i/r/dir',
      type: 'Directory',
      mode: 0o751
    },
    '',
    ''
  ])

  new Unpack({
    umask: 0o027,
    cwd: dir
  }).on('close', _ => {
    t.equal(fs.statSync(dir + '/d/i/r').mode & 0o7777, 0o750)
    t.equal(fs.statSync(dir + '/d/i/r/dir').mode & 0o7777, 0o751)
    t.end()
  }).end(data)
})

t.test('absolute paths', t => {
  const dir = path.join(unpackdir, 'absolute-paths')
  t.teardown(_ => rimraf.sync(dir))
  t.beforeEach(cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const absolute = path.resolve(dir, 'd/i/r/absolute')
  t.ok(path.isAbsolute(absolute))
  const parsed = path.parse(absolute)
  const relative = absolute.substr(parsed.root.length)
  t.notOk(path.isAbsolute(relative))

  const data = makeTar([
    {
      path: absolute,
      type: 'File',
      size: 1,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    'a',
    '',
    ''
  ])

  t.test('warn and correct', t => {
    const check = t => {
      t.same(warnings, [[
        'stripping / from absolute path',
        absolute
      ]])
      t.ok(fs.lstatSync(path.resolve(dir, relative)).isFile(), 'is file')
      t.end()
    }

    const warnings = []

    t.test('async', t => {
      warnings.length = 0
      new Unpack({
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).on('close', _=> check(t)).end(data)
    })

    t.test('sync', t => {
      warnings.length = 0
      new UnpackSync({
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).end(data)
      check(t)
    })

    t.end()
  })

  t.test('preserve absolute path', t => {
    const check = t => {
      t.same(warnings, [])
      t.ok(fs.lstatSync(absolute).isFile(), 'is file')
      t.end()
    }

    const warnings = []

    t.test('async', t => {
      warnings.length = 0
      new Unpack({
        preservePaths: true,
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).on('close', _=> check(t)).end(data)
    })

    t.test('sync', t => {
      warnings.length = 0
      new UnpackSync({
        preservePaths: true,
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).end(data)
      check(t)
    })

    t.end()
  })

  t.end()
})

t.test('absolute paths with more than one root', t => {
  // Stripping only the first root off of a path left paths like
  // '////home/user/.bashrc' or 'c:/c:/c:/x' absolute, so the entry still
  // escaped the extraction target.  Every root has to come off, not just
  // the first one.
  const dir = path.join(unpackdir, 'absolute-paths-multi-root')
  const escape = path.join(unpackdir, 'multi-root-escape.txt')
  t.teardown(_ => {
    rimraf.sync(dir)
    rimraf.sync(escape)
  })
  t.beforeEach(cb => {
    rimraf.sync(dir)
    rimraf.sync(escape)
    mkdirp.sync(dir)
    cb()
  })

  const root = path.parse(escape).root
  const stacked = root + root + root + escape
  t.ok(path.isAbsolute(stacked))

  const data = makeTar([
    {
      path: stacked,
      type: 'File',
      size: 1,
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    'a',
    '',
    ''
  ])

  t.test('warn and correct', t => {
    const warnings = []
    const check = t => {
      t.match(warnings, [[
        /^stripping .* from absolute path$/,
        stacked
      ]])
      t.notOk(fs.existsSync(escape), 'did not escape the extraction target')
      t.ok(fs.readdirSync(dir).length > 0, 'extracted under the cwd')
      t.end()
    }

    t.test('async', t => {
      warnings.length = 0
      new Unpack({
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).on('close', _ => check(t)).end(data)
    })

    t.test('sync', t => {
      warnings.length = 0
      new UnpackSync({
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).end(data)
      check(t)
    })

    t.end()
  })

  t.test('stacked drive roots', t => {
    const stackedDrive = 'c:/c:/c:/x/y/z'
    const driveData = makeTar([
      {
        path: stackedDrive,
        type: 'File',
        size: 1,
        mtime: new Date('2011-03-27T22:16:31.000Z')
      },
      'a',
      '',
      ''
    ])

    const warnings = []
    const check = t => {
      t.same(warnings, [[
        'stripping c:/c:/c:/ from absolute path',
        stackedDrive
      ]])
      t.equal(fs.readFileSync(path.resolve(dir, 'x/y/z'), 'utf8'), 'a')
      t.notOk(fs.existsSync(path.resolve(dir, 'c:')), 'no root left behind')
      t.end()
    }

    t.test('async', t => {
      warnings.length = 0
      new Unpack({
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).on('close', _ => check(t)).end(driveData)
    })

    t.test('sync', t => {
      warnings.length = 0
      new UnpackSync({
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).end(driveData)
      check(t)
    })

    t.end()
  })

  t.end()
})

t.test('.. paths', t => {
  const dir = path.join(unpackdir, 'dotted-paths')
  t.teardown(_ => rimraf.sync(dir))
  t.beforeEach(cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const fmode = 0o755
  const dotted = 'a/b/c/../d'
  const resolved = path.resolve(dir, dotted)

  const data = makeTar([
    {
      path: dotted,
      type: 'File',
      size: 1,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    'd',
    '',
    ''
  ])

  t.test('warn and skip', t => {
    const check = t => {
      t.same(warnings, [[
        'path contains \'..\'',
        dotted
      ]])
      t.throws(_=>fs.lstatSync(resolved))
      t.end()
    }

    const warnings = []

    t.test('async', t => {
      warnings.length = 0
      new Unpack({
        fmode: fmode,
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).on('close', _=> check(t)).end(data)
    })

    t.test('sync', t => {
      warnings.length = 0
      new UnpackSync({
        fmode: fmode,
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).end(data)
      check(t)
    })

    t.end()
  })

  t.test('preserve dotted path', t => {
    const check = t => {
      t.same(warnings, [])
      t.ok(fs.lstatSync(resolved).isFile(), 'is file')
      t.equal(fs.lstatSync(resolved).mode & 0o777, fmode, 'mode is 0755')
      t.end()
    }

    const warnings = []

    t.test('async', t => {
      warnings.length = 0
      new Unpack({
        fmode: fmode,
        preservePaths: true,
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).on('close', _=> check(t)).end(data)
    })

    t.test('sync', t => {
      warnings.length = 0
      new UnpackSync({
        fmode: fmode,
        preservePaths: true,
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).end(data)
      check(t)
    })

    t.end()
  })

  t.end()
})

t.test('drive-relative paths', t => {
  // A windows drive-relative path like 'c:..\foo' is not "absolute"
  // according to path.win32.isAbsolute(), so its root was never stripped,
  // and the '..' hid from the dotted-path check because it is preceded by
  // a ':' rather than a path separator.  On windows such a path is still
  // resolved against the drive's current directory, so it escapes the
  // extraction target.
  const dir = path.join(unpackdir, 'drive-relative-paths')
  t.teardown(_ => rimraf.sync(dir))
  t.beforeEach(cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const escapes = [
    'c:..\\foo\\bar',
    'c:../foo/bar',
    'C:..\\..\\..\\foo\\bar',
    '/c:../foo/bar',
    'c:..'
  ]

  const chunks = []
  escapes.forEach(p => {
    chunks.push({
      path: p,
      type: 'File',
      size: 1,
      mtime: new Date('2011-03-27T22:16:31.000Z')
    })
    chunks.push('a')
  })
  chunks.push('')
  chunks.push('')
  const data = makeTar(chunks)

  t.test('warn and skip', t => {
    const warnings = []
    const check = t => {
      t.same(warnings, escapes.map(p => ['path contains \'..\'', p]),
        'every drive-relative escape is rejected')
      t.same(fs.readdirSync(dir), [], 'nothing was extracted')
      t.end()
    }

    t.test('async', t => {
      warnings.length = 0
      new Unpack({
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).on('close', _ => check(t)).end(data)
    })

    t.test('sync', t => {
      warnings.length = 0
      new UnpackSync({
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).end(data)
      check(t)
    })

    t.end()
  })

  t.test('drive-absolute paths are still just relativized', t => {
    const absolute = 'c:/x/y/z'
    const absData = makeTar([
      {
        path: absolute,
        type: 'File',
        size: 1,
        mtime: new Date('2011-03-27T22:16:31.000Z')
      },
      'a',
      '',
      ''
    ])

    const warnings = []
    const check = t => {
      t.same(warnings, [[
        'stripping c:/ from absolute path',
        absolute
      ]])
      t.equal(fs.readFileSync(path.resolve(dir, 'x/y/z'), 'utf8'), 'a')
      t.end()
    }

    t.test('async', t => {
      warnings.length = 0
      new Unpack({
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).on('close', _ => check(t)).end(absData)
    })

    t.test('sync', t => {
      warnings.length = 0
      new UnpackSync({
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).end(absData)
      check(t)
    })

    t.end()
  })

  t.end()
})

t.test('drive-relative symlink targets', t => {
  // A symlink target is resolved against the directory the link lives in,
  // so a windows drive-relative target like 'c:..\foo\bar' walks out of the
  // extraction directory once the drive root resolves.  The root hid the
  // '..' from every path check, because the check only ever looked at
  // entry.path, and linkpath was never examined at all.
  const dir = path.join(unpackdir, 'drive-relative-linkpaths')
  t.teardown(_ => rimraf.sync(dir))
  t.beforeEach(cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const escapes = [
    { path: 'a/winrootdotsescapelink', linkpath: 'c:..\\..\\..\\..\\foo\\bar' },
    { path: 'winrootdotslink', linkpath: 'c:..' },
    { path: 'winrootslashlink', linkpath: 'c:../foo/bar' },
    { path: 'a/b/doublerootlink', linkpath: '/c:../../../foo/bar' }
  ]

  const chunks = escapes.map(e => ({
    path: e.path,
    type: 'SymbolicLink',
    linkpath: e.linkpath,
    mtime: new Date('2011-03-27T22:16:31.000Z')
  }))
  chunks.push('')
  chunks.push('')
  const data = makeTar(chunks)

  t.test('warn and skip', t => {
    const warnings = []
    const check = t => {
      t.same(warnings, escapes.map(e =>
        ['linkpath contains \'..\'', e.linkpath]),
        'every escaping symlink target is rejected')
      escapes.forEach(e => t.throws(
        _ => fs.lstatSync(path.resolve(dir, e.path)),
        'escaping symlink is not created'))
      t.same(fs.readdirSync(dir), [], 'nothing was extracted')
      t.end()
    }

    t.test('async', t => {
      warnings.length = 0
      new Unpack({
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).on('close', _ => check(t)).end(data)
    })

    t.test('sync', t => {
      warnings.length = 0
      new UnpackSync({
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).end(data)
      check(t)
    })

    t.end()
  })

  t.test('drive-relative target is rejected even when it stays inside', t => {
    // 'a/b/ok' -> 'c:..\foo\bar' resolves to 'a/foo/bar', which happens to
    // stay inside the extraction directory, but linkpath is now sanitized
    // exactly like path: stripping the drive root exposes the '..', and any
    // '..' in a link target is rejected outright, the same way it always
    // has been for the entry's own path.
    const inside = 'a/b/ok'
    const linkpath = 'c:..\\foo\\bar'
    const insideData = makeTar([
      {
        path: inside,
        type: 'SymbolicLink',
        linkpath: linkpath,
        mtime: new Date('2011-03-27T22:16:31.000Z')
      },
      '',
      ''
    ])

    const warnings = []
    const check = t => {
      t.same(warnings, [['linkpath contains \'..\'', linkpath]],
        'drive-relative target is rejected')
      t.throws(_ => fs.lstatSync(path.resolve(dir, inside)),
        'symlink is not created')
      t.same(fs.readdirSync(dir), [], 'nothing was extracted')
      t.end()
    }

    t.test('async', t => {
      warnings.length = 0
      new Unpack({
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).on('close', _ => check(t)).end(insideData)
    })

    t.test('sync', t => {
      warnings.length = 0
      new UnpackSync({
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).end(insideData)
      check(t)
    })

    t.end()
  })

  t.end()
})

t.test('fail all stats', t => {
  const poop = new Error('poop')
  poop.code = 'EPOOP'
  let unmutate
  const dir = path.join(unpackdir, 'stat-fail')

  const warnings = []
  t.beforeEach(cb => {
    warnings.length = 0
    mkdirp.sync(dir)
    unmutate = mutateFS.statFail(poop)
    cb()
  })
  t.afterEach(cb => {
    unmutate()
    rimraf.sync(dir)
    cb()
  })

  const data = makeTar([
    {
      path: 'd/i/r/file/',
      type: 'Directory',
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    {
      path: 'd/i/r/dir/',
      type: 'Directory',
      mode: 0o751,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    {
      path: 'd/i/r/file',
      type: 'File',
      size: 1,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    'a',
    {
      path: 'd/i/r/link',
      type: 'Link',
      linkpath: 'd/i/r/file',
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    {
      path: 'd/i/r/symlink',
      type: 'SymbolicLink',
      linkpath: './dir',
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    '',
    ''
  ])

  const check = (t, expect) => {
    t.match(warnings, expect)
    warnings.forEach(w => t.equal(w[0], w[1].message))
    t.end()
  }

  t.test('async', t => {
    const expect = [
      ['poop', poop],
      ['poop', poop]
    ]
    new Unpack({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).on('close', _ => check(t, expect)).end(data)
  })

  t.test('sync', t => {
    const expect = [
      [
        String,
        {
          code: 'EISDIR',
          path: path.resolve(dir, 'd/i/r/file'),
          syscall: 'open'
        }
      ],
      [
        String,
        {
          dest: path.resolve(dir, 'd/i/r/link'),
          path: path.resolve(dir, 'd/i/r/file'),
          syscall: 'link'
        }
      ]
    ]
    new UnpackSync({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).end(data)
    check(t, expect)
  })

  t.end()
})

t.test('fail symlink', t => {
  const poop = new Error('poop')
  poop.code = 'EPOOP'
  const unmutate = mutateFS.fail('symlink', poop)
  const dir = path.join(unpackdir, 'symlink-fail')
  t.teardown(_ => (unmutate(), rimraf.sync(dir)))

  const warnings = []
  t.beforeEach(cb => {
    warnings.length = 0
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const data = makeTar([
    {
      path: 'd/i/r/dir/',
      type: 'Directory',
      mode: 0o751,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    {
      path: 'd/i/r/symlink',
      type: 'SymbolicLink',
      linkpath: './dir',
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    '',
    ''
  ])

  const check = (t, expect) => {
    t.match(warnings, expect)
    warnings.forEach(w => t.equal(w[0], w[1].message))
    t.end()
  }

  t.test('async', t => {
    const expect = [['poop', poop]]
    new Unpack({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).on('close', _ => check(t, expect)).end(data)
  })

  t.test('sync', t => {
    const expect = [['poop', poop]]
    new UnpackSync({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).end(data)
    check(t, expect)
  })

  t.end()
})

t.test('fail chmod', t => {
  const poop = new Error('poop')
  poop.code = 'EPOOP'
  const unmutate = mutateFS.fail('chmod', poop)
  const dir = path.join(unpackdir, 'chmod-fail')
  t.teardown(_ => (unmutate(), rimraf.sync(dir)))

  const warnings = []
  t.beforeEach(cb => {
    warnings.length = 0
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const data = makeTar([
    {
      path: 'd/i/r/dir/',
      type: 'Directory',
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    {
      path: 'd/i/r/dir/',
      type: 'Directory',
      mode: 0o751,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    '',
    ''
  ])

  const check = (t, expect) => {
    t.match(warnings, expect)
    warnings.forEach(w => t.equal(w[0], w[1].message))
    t.end()
  }

  t.test('async', t => {
    const expect = [['poop', poop]]
    new Unpack({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).on('close', _ => check(t, expect)).end(data)
  })

  t.test('sync', t => {
    const expect = [['poop', poop]]
    new UnpackSync({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).end(data)
    check(t, expect)
  })

  t.end()
})

t.test('fail mkdir', t => {
  const poop = new Error('poop')
  poop.code = 'EPOOP'
  let unmutate
  const dir = path.join(unpackdir, 'mkdir-fail')
  t.teardown(_ => rimraf.sync(dir))

  const warnings = []
  t.beforeEach(cb => {
    warnings.length = 0
    rimraf.sync(dir)
    mkdirp.sync(dir)
    unmutate = mutateFS.fail('mkdir', poop)
    cb()
  })
  t.afterEach(cb => {
    unmutate()
    cb()
  })

  const data = makeTar([
    {
      path: 'dir/',
      type: 'Directory',
      mode: 0o751,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    '',
    ''
  ])

  const expect = [ [
    'ENOENT: no such file or directory, lstat \'' +
    path.resolve(dir, 'dir') + '\'',
    {
      code: 'ENOENT',
      syscall: 'lstat',
      path: path.resolve(dir, 'dir')
    }
  ] ]

  const check = t => {
    t.match(warnings, expect)
    warnings.forEach(w => t.equal(w[0], w[1].message))
    t.end()
  }

  t.test('async', t => {
    new Unpack({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).on('close', _ => check(t)).end(data)
  })

  t.test('sync', t => {
    new UnpackSync({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).end(data)
    check(t)
  })

  t.end()
})

t.test('fail write', t => {
  const poop = new Error('poop')
  poop.code = 'EPOOP'
  const unmutate = mutateFS.fail('write', poop)
  const dir = path.join(unpackdir, 'write-fail')
  t.teardown(_ => (unmutate(), rimraf.sync(dir)))

  const warnings = []
  t.beforeEach(cb => {
    warnings.length = 0
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const data = makeTar([
    {
      path: 'x',
      type: 'File',
      size: 1,
      mode: 0o751,
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    'x',
    '',
    ''
  ])

  const expect = [ [ 'poop', poop ] ]

  const check = t => {
    t.match(warnings, expect)
    warnings.forEach(w => t.equal(w[0], w[1].message))
    t.end()
  }

  t.test('async', t => {
    new Unpack({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).on('close', _ => check(t)).end(data)
  })

  t.test('sync', t => {
    new UnpackSync({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).end(data)
    check(t)
  })

  t.end()
})

t.test('skip existing', t => {
  const dir = path.join(unpackdir, 'skip-newer')
  t.teardown(_ => rimraf.sync(dir))

  const date = new Date('2011-03-27T22:16:31.000Z')
  t.beforeEach(cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
    fs.writeFileSync(dir + '/x', 'y')
    fs.utimesSync(dir + '/x', date, date)
    cb()
  })

  const data = makeTar([
    {
      path: 'x',
      type: 'File',
      size: 1,
      mode: 0o751,
      mtime: new Date('2013-12-19T17:00:00.000Z')
    },
    'x',
    '',
    ''
  ])

  const check = t => {
    const st = fs.lstatSync(dir + '/x')
    t.equal(st.atime.toISOString(), date.toISOString())
    t.equal(st.mtime.toISOString(), date.toISOString())
    const data = fs.readFileSync(dir + '/x', 'utf8')
    t.equal(data, 'y')
    t.end()
  }

  t.test('async', t => {
    new Unpack({
      cwd: dir,
      keep: true
    }).on('close', _ => check(t)).end(data)
  })

  t.test('sync', t => {
    new UnpackSync({
      cwd: dir,
      keep: true
    }).end(data)
    check(t)
  })

  t.end()
})

t.test('skip newer', t => {
  const dir = path.join(unpackdir, 'skip-newer')
  t.teardown(_ => rimraf.sync(dir))

  const date = new Date('2013-12-19T17:00:00.000Z')
  t.beforeEach(cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
    fs.writeFileSync(dir + '/x', 'y')
    fs.utimesSync(dir + '/x', date, date)
    cb()
  })

  const data = makeTar([
    {
      path: 'x',
      type: 'File',
      size: 1,
      mode: 0o751,
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    'x',
    '',
    ''
  ])

  const check = t => {
    const st = fs.lstatSync(dir + '/x')
    t.equal(st.atime.toISOString(), date.toISOString())
    t.equal(st.mtime.toISOString(), date.toISOString())
    const data = fs.readFileSync(dir + '/x', 'utf8')
    t.equal(data, 'y')
    t.end()
  }

  t.test('async', t => {
    new Unpack({
      cwd: dir,
      newer: true
    }).on('close', _ => check(t)).end(data)
  })

  t.test('sync', t => {
    new UnpackSync({
      cwd: dir,
      newer: true
    }).end(data)
    check(t)
  })

  t.end()
})

t.test('no mtime', t => {
  const dir = path.join(unpackdir, 'skip-newer')
  t.teardown(_ => rimraf.sync(dir))

  t.beforeEach(cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const date = new Date('2011-03-27T22:16:31.000Z')
  const data = makeTar([
    {
      path: 'x/',
      type: 'Directory',
      size: 0,
      atime: date,
      ctime: date,
      mtime: date
    },
    {
      path: 'x/y',
      type: 'File',
      size: 1,
      mode: 0o751,
      atime: date,
      ctime: date,
      mtime: date
    },
    'x',
    '',
    ''
  ])

  const check = t => {
    // this may fail if it's run on March 27, 2011
    const stx = fs.lstatSync(dir + '/x')
    t.notEqual(stx.atime.toISOString(), date.toISOString())
    t.notEqual(stx.mtime.toISOString(), date.toISOString())
    const sty = fs.lstatSync(dir + '/x/y')
    t.notEqual(sty.atime.toISOString(), date.toISOString())
    t.notEqual(sty.mtime.toISOString(), date.toISOString())
    const data = fs.readFileSync(dir + '/x/y', 'utf8')
    t.equal(data, 'x')
    t.end()
  }

  t.test('async', t => {
    new Unpack({
      cwd: dir,
      noMtime: true
    }).on('close', _ => check(t)).end(data)
  })

  t.test('sync', t => {
    new UnpackSync({
      cwd: dir,
      noMtime: true
    }).end(data)
    check(t)
  })

  t.end()
})

t.test('unpack big enough to pause/drain', t => {
  const dir = path.resolve(unpackdir, 'drain-clog')
  mkdirp.sync(dir)
  t.tearDown(_ => rimraf.sync(dir))
  const stream = fs.createReadStream(fixtures + '/parses.tar')
  const u = new Unpack({
    cwd: dir,
    strip: 3,
    strict: true
  })

  u.on('ignoredEntry', entry =>
    t.fail('should not get ignored entry: ' + entry.path))

  u.on('close', _ => {
    t.pass('extraction finished')
    const actual = fs.readdirSync(dir)
    const expected = fs.readdirSync(parses)
    t.same(actual, expected)
    t.end()
  })

  stream.pipe(u)
})

t.test('set owner', t => {
  // fake it on platforms that don't have getuid
  const myUid = 501
  const myGid = 1024
  const getuid = process.getuid
  const getgid = process.getgid
  process.getuid = _ => myUid
  process.getgid = _ => myGid
  t.teardown(_ => (process.getuid = getuid, process.getgid = getgid))

  // can't actually do this because it requires root, but we can
  // verify that chown gets called.
  t.test('as root, defaults to true', t => {
    const getuid = process.getuid
    process.getuid = _ => 0
    const u = new Unpack()
    t.equal(u.preserveOwner, true, 'preserveOwner enabled')
    process.getuid = getuid
    t.end()
  })

  t.test('as non-root, defaults to false', t => {
    const getuid = process.getuid
    process.getuid = _ => 501
    const u = new Unpack()
    t.equal(u.preserveOwner, false, 'preserveOwner disabled')
    process.getuid = getuid
    t.end()
  })

  const data = makeTar([
    {
      uid: 2456124561,
      gid: 813708013,
      path: 'foo/',
      type: 'Directory'
    },
    {
      uid: myUid,
      gid: 813708013,
      path: 'foo/my-uid-different-gid',
      type: 'File',
      size: 3
    },
    'qux',
    {
      uid: 2456124561,
      path: 'foo/different-uid-nogid',
      type: 'Directory'
    },
    {
      uid: 2456124561,
      path: 'foo/different-uid-nogid/bar',
      type: 'File',
      size: 3
    },
    'qux',
    {
      gid: 813708013,
      path: 'foo/different-gid-nouid/bar',
      type: 'File',
      size: 3
    },
    'qux',
    {
      uid: myUid,
      gid: myGid,
      path: 'foo-mine/',
      type: 'Directory'
    },
    {
      uid: myUid,
      gid: myGid,
      path: 'foo-mine/bar',
      type: 'File',
      size: 3
    },
    'qux',
    {
      uid: myUid,
      path: 'foo-mine/nogid',
      type: 'Directory'
    },
    {
      uid: myUid,
      path: 'foo-mine/nogid/bar',
      type: 'File',
      size: 3
    },
    'qux',
    '',
    ''
  ])

  t.test('chown failure results in unpack failure', t => {
    const dir = path.resolve(unpackdir, 'chown')
    const poop = new Error('expected chown failure')
    const un = mutateFS.fail('chown', poop)
    const unl = mutateFS.fail('lchown', poop)
    const unf = mutateFS.fail('fchown', poop)

    t.teardown(_ => (un(), unf(), unl()))

    t.test('sync', t => {
      mkdirp.sync(dir)
      t.teardown(_ => rimraf.sync(dir))
      let warned = false
      const u = new Unpack.Sync({
        cwd: dir,
        preserveOwner: true,
        onwarn: (m, er) => {
          if (!warned) {
            warned = true
            t.equal(er, poop)
            t.end()
          }
        }
      })
      u.end(data)
    })

    t.test('async', t => {
      mkdirp.sync(dir)
      t.teardown(_ => rimraf.sync(dir))
      let warned = false
      const u = new Unpack({
        cwd: dir,
        preserveOwner: true,
        onwarn: (m, er) => {
          if (!warned) {
            warned = true
            t.equal(er, poop)
          }
        }
      })
      // the extraction has to be allowed to finish before the teardown
      // removes the cwd out from under the entries that are still in
      // flight, or one of them raises an unhandled CwdError
      u.on('close', _ => t.end())
      u.end(data)
    })

    t.test('cleanup', t => {
      rimraf.sync(dir)
      t.end()
    })

    t.end()
  })

  t.test('chown when true', t => {
    const dir = path.resolve(unpackdir, 'chown')
    const chown = fs.chown
    const chownSync = fs.chownSync
    const fchownSync = fs.fchownSync
    let called = 0
    fs.fchown = fs.chown = (path, owner, group, cb) => {
      called ++
      cb()
    }
    fs.chownSync = fs.fchownSync = _ => called++

    t.teardown(_ => {
      fs.chown = chown
      fs.chownSync = chownSync
      fs.fchownSync = fchownSync
    })

    t.test('sync', t => {
      mkdirp.sync(dir)
      t.teardown(_ => rimraf.sync(dir))
      called = 0
      const u = new Unpack.Sync({ cwd: dir, preserveOwner: true })
      u.end(data)
      t.ok(called >= 5, 'called chowns')
      t.end()
    })

    t.test('async', t => {
      mkdirp.sync(dir)
      t.teardown(_ => rimraf.sync(dir))
      called = 0
      const u = new Unpack({ cwd: dir, preserveOwner: true })
      u.end(data)
      u.on('close', _ => {
        t.ok(called >= 5, 'called chowns')
        t.end()
      })
    })

    t.end()
  })

  t.test('no chown when false', t => {
    const dir = path.resolve(unpackdir, 'nochown')
    const poop = new Error('poop')
    const un = mutateFS.fail('chown', poop)
    const unf = mutateFS.fail('fchown', poop)
    const unl = mutateFS.fail('lchown', poop)
    t.teardown(_ => {
      rimraf.sync(dir)
      un()
      unf()
      unl()
    })

    t.beforeEach(cb => mkdirp(dir, cb))
    t.afterEach(cb => rimraf(dir, cb))

    const check = t => {
      const dirStat = fs.statSync(dir + '/foo')
      t.notEqual(dirStat.uid, 2456124561)
      t.notEqual(dirStat.gid, 813708013)
      const fileStat = fs.statSync(dir + '/foo/my-uid-different-gid')
      t.notEqual(fileStat.uid, 2456124561)
      t.notEqual(fileStat.gid, 813708013)
      const dirStat2 = fs.statSync(dir + '/foo/different-uid-nogid')
      t.notEqual(dirStat2.uid, 2456124561)
      const fileStat2 = fs.statSync(dir + '/foo/different-uid-nogid/bar')
      t.notEqual(fileStat2.uid, 2456124561)
      t.end()
    }

    t.test('sync', t => {
      const u = new Unpack.Sync({ cwd: dir, preserveOwner: false })
      u.end(data)
      check(t)
    })

    t.test('async', t => {
      const u = new Unpack({ cwd: dir, preserveOwner: false })
      u.end(data)
      u.on('close', _ => check(t))
    })

    t.end()
  })

  t.end()
})

t.test('unpack when dir is not writable', t => {
  const data = makeTar([
    {
      path: 'a/',
      type: 'Directory',
      mode: 0o444
    },
    {
      path: 'a/b',
      type: 'File',
      size: 1
    },
    'a',
    '',
    ''
  ])

  const dir = path.resolve(unpackdir, 'nowrite-dir')
  t.beforeEach(cb => mkdirp(dir, cb))
  t.afterEach(cb => rimraf(dir, cb))

  const check = t => {
    t.equal(fs.statSync(dir + '/a').mode & 0o7777, 0o744)
    t.equal(fs.readFileSync(dir + '/a/b', 'utf8'), 'a')
    t.end()
  }

  t.test('sync', t => {
    const u = new Unpack.Sync({ cwd: dir, strict: true })
    u.end(data)
    check(t)
  })

  t.test('async', t => {
    const u = new Unpack({ cwd: dir, strict: true })
    u.end(data)
    u.on('close', _ => check(t))
  })

  t.end()
})

t.test('transmute chars on windows', t => {
  const data = makeTar([
    {
      path: '<|>?:.txt',
      size: 5,
      type: 'File'
    },
    '<|>?:',
    '',
    ''
  ])

  const dir = path.resolve(unpackdir, 'winchars')
  t.beforeEach(cb => mkdirp(dir, cb))
  t.afterEach(cb => rimraf(dir, cb))

  const hex = 'ef80bcef81bcef80beef80bfef80ba2e747874'
  const uglyName = Buffer.from(hex, 'hex').toString()
  const ugly = path.resolve(dir, uglyName)

  const check = t => {
    t.same(fs.readdirSync(dir), [ uglyName ])
    t.equal(fs.readFileSync(ugly, 'utf8'), '<|>?:')
    t.end()
  }

  t.test('async', t => {
    const u = new Unpack({
      cwd: dir,
      win32: true
    })
    u.end(data)
    u.on('close', _ => check(t))
  })

  t.test('sync', t => {
    const u = new Unpack.Sync({
      cwd: dir,
      win32: true
    })
    u.end(data)
    check(t)
  })

  t.end()
})

t.test('safely transmute chars on windows with absolutes', t => {
  // don't actually make the directory
  const poop = new Error('poop')
  t.teardown(mutateFS.fail('mkdir', poop))

  const data = makeTar([
    {
      path: 'c:/x/y/z/<|>?:.txt',
      size: 5,
      type: 'File'
    },
    '<|>?:',
    '',
    ''
  ])

  const hex = 'ef80bcef81bcef80beef80bfef80ba2e747874'
  const uglyName = Buffer.from(hex, 'hex').toString()
  const uglyPath = 'c:/x/y/z/' + uglyName

  const u = new Unpack({
    win32: true,
    preservePaths: true
  })
  u.on('entry', entry => {
    t.equal(entry.path, uglyPath)
    t.end()
  })

  u.end(data)
})

t.test('use explicit chmod when required by umask', t => {
  process.umask(0o022)

  const basedir = path.resolve(unpackdir, 'umask-chmod')

  const data = makeTar([
    {
      path: 'x/y/z',
      mode: 0o775,
      type: 'Directory'
    },
    '',
    ''
  ])

  const check = t => {
    const st = fs.statSync(basedir + '/x/y/z')
    t.equal(st.mode & 0o777, 0o775)
    rimraf.sync(basedir)
    t.end()
  }

  t.test('async', t => {
    mkdirp.sync(basedir)
    const unpack = new Unpack({ cwd: basedir })
    unpack.on('close', _ => check(t))
    unpack.end(data)
  })

  return t.test('sync', t => {
    mkdirp.sync(basedir)
    const unpack = new Unpack.Sync({ cwd: basedir })
    unpack.end(data)
    check(t)
  })
})

t.test('chown implicit dirs and also the entries', t => {
  const basedir = path.resolve(unpackdir, 'chownr')

  // club these so that the test can run as non-root
  const chown = fs.chown
  const chownSync = fs.chownSync
  const lchown = fs.lchown
  const lchownSync = fs.lchownSync
  const fchown = fs.fchown
  const fchownSync = fs.fchownSync

  const getuid = process.getuid
  const getgid = process.getgid
  t.teardown(_ => {
    fs.chown = chown
    fs.chownSync = chownSync
    fs.lchown = lchown
    fs.lchownSync = lchownSync
    fs.fchown = fchown
    fs.fchownSync = fchownSync
    process.getgid = getgid
  })

  let chowns = 0

  let currentTest = null
  fs.fchown = fs.chown = (path, uid, gid, cb) => {
    currentTest.equal(uid, 420, 'chown(' + path + ') uid')
    currentTest.equal(gid, 666, 'chown(' + path + ') gid')
    chowns ++
    cb()
  }
  if (fs.lchown)
    fs.lchown = fs.fchown

  fs.chownSync = fs.fchownSync = (path, uid, gid) => {
    currentTest.equal(uid, 420, 'chownSync(' + path + ') uid')
    currentTest.equal(gid, 666, 'chownSync(' + path + ') gid')
    chowns ++
  }
  if (fs.lchownSync)
    fs.lchownSync = fs.fchownSync

  const data = makeTar([
    {
      path: 'a/b/c',
      mode: 0o775,
      type: 'File',
      size: 1,
      uid: null,
      gid: null
    },
    '.',
    {
      path: 'x/y/z',
      mode: 0o775,
      uid: 12345,
      gid: 54321,
      type: 'File',
      size: 1
    },
    '.',
    '',
    ''
  ])

  const check = t => {
    currentTest = null
    t.equal(chowns, 8)
    chowns = 0
    rimraf.sync(basedir)
    t.end()
  }

  t.test('throws when setting uid/gid improperly', t => {
    t.throws(_ => new Unpack({ uid: 420 }),
      TypeError('cannot set owner without number uid and gid'))
    t.throws(_ => new Unpack({ gid: 666 }),
      TypeError('cannot set owner without number uid and gid'))
    t.throws(_ => new Unpack({ uid: 1, gid: 2, preserveOwner: true }),
      TypeError('cannot preserve owner in archive and also set owner explicitly'))
    t.end()
  })

  const tests = () =>
    t.test('async', t => {
      currentTest = t
      mkdirp.sync(basedir)
      const unpack = new Unpack({ cwd: basedir, uid: 420, gid: 666 })
      unpack.on('close', _ => check(t))
      unpack.end(data)
    }).then(t.test('sync', t => {
      currentTest = t
      mkdirp.sync(basedir)
      const unpack = new Unpack.Sync({ cwd: basedir, uid: 420, gid: 666 })
      unpack.end(data)
      check(t)
    }))

  tests()

  t.test('make it look like processUid is 420', t => {
    process.getuid = () => 420
    t.end()
  })

  tests()

  t.test('make it look like processGid is 666', t => {
    process.getuid = getuid
    process.getgid = () => 666
    t.end()
  })

  return tests()
})

t.test('bad cwd setting', t => {
  const basedir = path.resolve(unpackdir, 'bad-cwd')
  mkdirp.sync(basedir)
  t.teardown(_ => rimraf.sync(basedir))

  const cases = [
    // the cwd itself
    {
      path: './',
      type: 'Directory'
    },
    // a file directly in the cwd
    {
      path: 'a',
      type: 'File'
    },
    // a file nested within a subdir of the cwd
    {
      path: 'a/b/c',
      type: 'File'
    }
  ]

  fs.writeFileSync(basedir + '/file', 'xyz')

  cases.forEach(c => t.test(c.type + ' ' + c.path, t => {
    const data = makeTar([
      {
        path: c.path,
        mode: 0o775,
        type: c.type,
        size: 0,
        uid: null,
        gid: null
      },
      '',
      ''
    ])

    t.test('cwd is a file', t => {
      const cwd = basedir + '/file'
      const opt = { cwd: cwd }

      t.throws(_ => new Unpack.Sync(opt).end(data), {
        name: 'CwdError',
        message: 'ENOTDIR: Cannot cd into \'' + cwd + '\'',
        path: cwd,
        code: 'ENOTDIR'
      })

      new Unpack(opt).on('error', er => {
        t.match(er, {
          name: 'CwdError',
          message: 'ENOTDIR: Cannot cd into \'' + cwd + '\'',
          path: cwd,
          code: 'ENOTDIR'
        })
        t.end()
      }).end(data)
    })

    return t.test('cwd is missing', t => {
      const cwd = basedir + '/asdf/asdf/asdf'
      const opt = { cwd: cwd }

      t.throws(_ => new Unpack.Sync(opt).end(data), {
        name: 'CwdError',
        message: 'ENOENT: Cannot cd into \'' + cwd + '\'',
        path: cwd,
        code: 'ENOENT'
      })

      new Unpack(opt).on('error', er => {
        t.match(er, {
          name: 'CwdError',
          message: 'ENOENT: Cannot cd into \'' + cwd + '\'',
          path: cwd,
          code: 'ENOENT'
        })
        t.end()
      }).end(data)
    })
  }))

  t.end()
})

t.test('transform', t => {
  const basedir = path.resolve(unpackdir, 'transform')
  t.teardown(_ => rimraf.sync(basedir))

  const cases = {
    'emptypax.tar': {
      '🌟.txt': '🌟✧✩⭐︎✪✫✬✭✮⚝✯✰✵✶✷✸✹❂⭑⭒★☆✡☪✴︎✦✡️🔯✴️🌠\n',
      'one-byte.txt': '[a]'
    },
    'body-byte-counts.tar': {
      '1024-bytes.txt': new Array(1024).join('[x]') + '[\n]',
      '512-bytes.txt': new Array(512).join('[x]') + '[\n]',
      'one-byte.txt': '[a]',
      'zero-byte.txt': ''
    },
    'utf8.tar': {
      '🌟.txt': '🌟✧✩⭐︎✪✫✬✭✮⚝✯✰✵✶✷✸✹❂⭑⭒★☆✡☪✴︎✦✡️🔯✴️🌠\n',
      'Ω.txt': '[Ω]',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt': '[Ω]'
    }
  }

  const txFn = entry => {
    switch (path.basename(entry.path)) {
      case 'zero-bytes.txt':
        return entry

      case 'one-byte.txt':
      case '1024-bytes.txt':
      case '512-bytes.txt':
      case 'Ω.txt':
        return new Bracer()
    }
  }

  class Bracer extends MiniPass {
    write (data) {
      const d = data.toString().split('').map(c => '[' + c + ']').join('')
      return super.write(d)
    }
  }

  const tarfiles = Object.keys(cases)
  t.plan(tarfiles.length)
  t.jobs = tarfiles.length

  tarfiles.forEach(tarfile => {
    t.test(tarfile, t => {
      const tf = path.resolve(tars, tarfile)
      const dir = path.resolve(basedir, tarfile)
      t.beforeEach(cb => {
        rimraf.sync(dir)
        mkdirp.sync(dir)
        cb()
      })

      const check = t => {
        const expect = cases[tarfile]
        Object.keys(expect).forEach(file => {
          const f = path.resolve(dir, file)
          t.equal(fs.readFileSync(f, 'utf8'), expect[file], file)
        })
        t.end()
      }

      t.plan(2)

      t.test('async unpack', t => {
        t.plan(2)
        t.test('strict', t => {
          const unpack = new Unpack({ cwd: dir, strict: true, transform: txFn })
          fs.createReadStream(tf).pipe(unpack)
          eos(unpack, _ => check(t))
        })
        t.test('loose', t => {
          const unpack = new Unpack({ cwd: dir, transform: txFn })
          fs.createReadStream(tf).pipe(unpack)
          eos(unpack, _ => check(t))
        })
      })

      t.test('sync unpack', t => {
        t.plan(2)
        t.test('strict', t => {
          const unpack = new UnpackSync({ cwd: dir, strict: true, transform: txFn })
          unpack.end(fs.readFileSync(tf))
          check(t)
        })
        t.test('loose', t => {
          const unpack = new UnpackSync({ cwd: dir, transform: txFn })
          unpack.end(fs.readFileSync(tf))
          check(t)
        })
      })
    })
  })
})

t.test('transform error', t => {
  const dir = path.resolve(unpackdir, 'transform-error')
  mkdirp.sync(dir)
  // The transform-error subtests abandon their writes mid-stream, so files can
  // still land in dir after the subtests resolve.  A single rimraf races them
  // and dies with ENOTEMPTY on the slower legacy node legs; retry a few times.
  t.teardown(_ => {
    for (let i = 0; i < 10; i++) {
      try {
        rimraf.sync(dir)
        return
      } catch (er) {
        if (i === 9)
          throw er
      }
    }
  })

  const tarfile = path.resolve(tars, 'body-byte-counts.tar')
  const tardata = fs.readFileSync(tarfile)
  const poop = new Error('poop')

  const txFn = () => {
    const tx = new MiniPass()
    tx.write = () => tx.emit('error', poop)
    tx.resume()
    return tx
  }

  t.test('sync unpack', t => {
    t.test('strict', t => {
      const unpack = new UnpackSync({ cwd: dir, strict: true, transform: txFn })
      const expect = 3
      let actual = 0
      unpack.on('error', er => {
        t.equal(er, poop)
        actual ++
      })
      unpack.end(tardata)
      t.equal(actual, expect, 'error count')
      t.end()
    })
    t.test('loose', t => {
      const unpack = new UnpackSync({ cwd: dir, transform: txFn })
      const expect = 3
      let actual = 0
      unpack.on('warn', (msg, er) => {
        t.equal(er, poop)
        actual ++
      })
      unpack.end(tardata)
      t.equal(actual, expect, 'error count')
      t.end()
    })
    t.end()
  })
  t.test('async unpack', t => {
    // the last error is about the folder being deleted, just ignore that one
    t.test('strict', t => {
      const unpack = new Unpack({ cwd: dir, strict: true, transform: txFn })
      t.plan(3)
      t.teardown(() => {
        unpack.removeAllListeners('error')
        unpack.on('error', () => {})
      })
      unpack.on('error', er => t.equal(er, poop))
      unpack.end(tardata)
    })
    t.test('loose', t => {
      const unpack = new Unpack({ cwd: dir, transform: txFn })
      t.plan(3)
      t.teardown(() => unpack.removeAllListeners('warn'))
      unpack.on('warn', (msg, er) => t.equal(er, poop))
      unpack.end(tardata)
    })
    t.end()
  })

  t.end()
})

t.test('futimes/fchown failures', t => {
  const archive = path.resolve(tars, 'utf8.tar')
  const dir = path.resolve(unpackdir, 'futimes-fchown-fails')
  const tardata = fs.readFileSync(archive)

  const poop = new Error('poop')
  const second = new Error('second error')

  const reset = cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
  }

  reset()
  t.teardown(() => rimraf.sync(dir))

  const methods = ['utimes', 'chown']
  methods.forEach(method => {
    const fc = method === 'chown'
    t.test(method +' fallback', t => {
      t.teardown(mutateFS.fail('f' + method, poop))
      // forceChown will fail on systems where the user is not root
      // and/or the uid/gid in the archive aren't valid. We're just
      // verifying coverage here, so make the method auto-pass.
      t.teardown(mutateFS.pass(method))
      t.plan(2)
      t.test('async unpack', t => {
        t.plan(2)
        t.test('strict', t => {
          reset()
          const unpack = new Unpack({ cwd: dir, strict: true, forceChown: fc })
          unpack.on('finish', t.end)
          unpack.end(tardata)
        })
        t.test('loose', t => {
          reset()
          const unpack = new Unpack({ cwd: dir, forceChown: fc })
          unpack.on('finish', t.end)
          unpack.on('warn', t.fail)
          unpack.end(tardata)
        })
      })
      t.test('sync unpack', t => {
        t.plan(2)
        t.test('strict', t => {
          reset()
          const unpack = new Unpack.Sync({ cwd: dir, strict: true, forceChown: fc })
          unpack.end(tardata)
          t.end()
        })
        t.test('loose', t => {
          reset()
          const unpack = new Unpack.Sync({ cwd: dir, forceChown: fc })
          unpack.on('warn', t.fail)
          unpack.end(tardata)
          t.end()
        })
      })
    })

    t.test('also fail ' + method, t => {
      const unmutate = mutateFS.fail('f' + method, poop)
      const unmutate2 = mutateFS.fail(method, second)
      t.teardown(() => {
        unmutate()
        unmutate2()
      })
      t.plan(2)
      t.test('async unpack', t => {
        t.plan(2)
        t.test('strict', t => {
          reset()
          const unpack = new Unpack({ cwd: dir, strict: true, forceChown: fc })
          t.plan(3)
          unpack.on('error', er => t.equal(er, poop))
          unpack.end(tardata)
        })
        t.test('loose', t => {
          reset()
          const unpack = new Unpack({ cwd: dir, forceChown: fc })
          t.plan(3)
          unpack.on('warn', (m, er) => t.equal(er, poop))
          unpack.end(tardata)
        })
      })
      t.test('sync unpack', t => {
        t.plan(2)
        t.test('strict', t => {
          reset()
          const unpack = new Unpack.Sync({ cwd: dir, strict: true, forceChown: fc })
          t.plan(3)
          unpack.on('error', er => t.equal(er, poop))
          unpack.end(tardata)
        })
        t.test('loose', t => {
          reset()
          const unpack = new Unpack.Sync({ cwd: dir, forceChown: fc })
          t.plan(3)
          unpack.on('warn', (m, er) => t.equal(er, poop))
          unpack.end(tardata)
        })
      })
    })
  })

  t.end()
})

t.test('onentry option is preserved', t => {
  const basedir = path.resolve(unpackdir, 'onentry-method')
  mkdirp.sync(basedir)
  t.teardown(() => rimraf.sync(basedir))

  let oecalls = 0
  const onentry = entry => oecalls++
  const data = makeTar([
    {
      path: 'd/i',
      type: 'Directory'
    },
    {
      path: 'd/i/r/dir',
      type: 'Directory',
      mode: 0o751,
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    {
      path: 'd/i/r/file',
      type: 'File',
      size: 1,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z')
    },
    'a',
    '',
    ''
  ])

  const check = t => {
    t.equal(oecalls, 3)
    oecalls = 0
    t.end()
  }

  t.test('sync', t => {
    const dir = path.join(basedir, 'sync')
    mkdirp.sync(dir)
    const unpack = new UnpackSync({ cwd: dir, onentry })
    unpack.end(data)
    check(t)
  })

  t.test('async', t => {
    const dir = path.join(basedir, 'async')
    mkdirp.sync(dir)
    const unpack = new Unpack({ cwd: dir, onentry })
    unpack.on('finish', () => check(t))
    unpack.end(data)
  })

  t.end()
})

t.test('do not reuse hardlinks, only nlink=1 files', t => {
  const basedir = path.resolve(unpackdir, 'hardlink-reuse')
  mkdirp.sync(basedir)
  t.teardown(() => rimraf.sync(basedir))

  const now = new Date('2018-04-30T18:30:39.025Z')

  const data = makeTar([
    {
      path: 'overwriteme',
      type: 'File',
      size: 4,
      mode: 0o644,
      mtime: now
    },
    'foo\n',
    {
      path: 'link',
      linkpath: 'overwriteme',
      type: 'Link',
      mode: 0o644,
      mtime: now
    },
    {
      path: 'link',
      type: 'File',
      size: 4,
      mode: 0o644,
      mtime: now
    },
    'bar\n',
    '',
    ''
  ])

  const checks = {
    'link': 'bar\n',
    'overwriteme': 'foo\n'
  }

  const check = t => {
    for (let f in checks) {
      t.equal(fs.readFileSync(basedir + '/' + f, 'utf8'), checks[f], f)
      t.equal(fs.statSync(basedir + '/' + f).nlink, 1, f)
    }
    t.end()
  }

  t.test('async', t => {
    const u = new Unpack({ cwd: basedir })
    u.on('close', () => check(t))
    u.end(data)
  })

  t.test('sync', t => {
    const u = new UnpackSync({ cwd: basedir })
    u.end(data)
    check(t)
  })

  t.end()
})

t.test('drop entry from dirCache if no longer a directory', t => {
  const dir = path.resolve(unpackdir, 'dir-cache-error')
  mkdirp.sync(dir + '/sync/y')
  mkdirp.sync(dir + '/async/y')
  const data = makeTar([
    {
      path: 'x',
      type: 'Directory'
    },
    {
      path: 'x',
      type: 'SymbolicLink',
      linkpath: './y'
    },
    {
      path: 'x/ginkoid',
      type: 'File',
      size: 'ginkoid'.length
    },
    'ginkoid',
    '',
    ''
  ])
  t.plan(2)
  const WARNINGS = {}
  const check = (t, path) => {
    t.equal(fs.statSync(path + '/x').isDirectory(), true)
    t.equal(fs.lstatSync(path + '/x').isSymbolicLink(), true)
    t.equal(fs.statSync(path + '/y').isDirectory(), true)
    t.strictSame(fs.readdirSync(path + '/y'), [])
    t.throws(_ => fs.readFileSync(path + '/x/ginkoid'), { code: 'ENOENT' })
    t.strictSame(WARNINGS[path], [
      'Cannot extract through symbolic link'
    ])
    t.end()
  }
  t.test('async', t => {
    const path = dir + '/async'
    new Unpack({ cwd: path })
      .on('warn', msg => WARNINGS[path] = [msg])
      .on('end', _ => check(t, path))
      .end(data)
  })
  t.test('sync', t => {
    const path = dir + '/sync'
    new UnpackSync({ cwd: path })
      .on('warn', msg => WARNINGS[path] = [msg])
      .end(data)
    check(t, path)
  })
})

t.test('dirCache is pruned case-insensitively', t => {
  // Directory entries land in the dirCache under the exact case the archive
  // used, but on a case-insensitive filesystem 'X' and 'x' name the same
  // entry, so a symlink called 'x' can take the place of the directory that
  // was cached as 'X'.  Pruning only exact matches left that stale directory
  // in the cache, so the following 'X/...' entry skipped the symlink check
  // and was written through the link, outside of the extraction target.
  //
  // A case-sensitive filesystem cannot hold both spellings of one name, so
  // the state a case-insensitive filesystem produces is set up here
  // directly: '<cwd>/X' is a symlink on disk, while the dirCache still
  // claims that it, and a child of it, is a directory.
  const base = path.resolve(unpackdir, 'dir-cache-case-insensitive')
  t.teardown(_ => rimraf.sync(base))

  const data = makeTar([
    {
      path: 'x',
      type: 'SymbolicLink',
      linkpath: './y'
    },
    {
      path: 'X/ginkoid',
      type: 'File',
      size: 'ginkoid'.length
    },
    'ginkoid',
    '',
    ''
  ])

  const setup = which => {
    const dir = base + '/' + which
    rimraf.sync(dir)
    mkdirp.sync(dir + '/y')
    fs.symlinkSync('./y', dir + '/X')
    // as though a Directory entry named 'X' had just been created here
    return {
      dir: dir,
      dirCache: new Map([[dir + '/X', true], [dir + '/X/Y', true]]),
      warnings: []
    }
  }

  const check = (t, c) => {
    t.notOk(c.dirCache.has(c.dir + '/X'),
      'stale case-variant dirCache entry was pruned')
    t.notOk(c.dirCache.has(c.dir + '/X/Y'),
      'stale case-variant child dirCache entry was pruned')
    t.equal(fs.lstatSync(c.dir + '/X').isSymbolicLink(), true,
      'X is still the symlink')
    t.strictSame(fs.readdirSync(c.dir + '/y'), [],
      'nothing was written through the symlink')
    t.throws(_ => fs.readFileSync(c.dir + '/X/ginkoid'), { code: 'ENOENT' },
      'the file was not created')
    t.strictSame(c.warnings, ['Cannot extract through symbolic link'])
    t.end()
  }

  t.test('async', t => {
    const c = setup('async')
    new Unpack({ cwd: c.dir, dirCache: c.dirCache })
      .on('warn', msg => c.warnings.push(msg))
      .on('end', _ => check(t, c))
      .end(data)
  })

  t.test('sync', t => {
    const c = setup('sync')
    new UnpackSync({ cwd: c.dir, dirCache: c.dirCache })
      .on('warn', msg => c.warnings.push(msg))
      .end(data)
    check(t, c)
  })

  t.end()
})

t.test('windows path separators are normalized', t => {
  // On windows both / and \ separate directories, so 'x\\y' and 'x/y' are
  // the same directory, but the dirCache was keyed by whichever spelling the
  // archive happened to use.  An entry could therefore poison the cache
  // under one spelling and then be replaced by a symlink under the other.
  // Every path that feeds the cache is normalized to / now.  The platform
  // has to be faked, because on posix \ is a legal filename character and
  // the normalization is deliberately a no-op there.
  const base = path.resolve(unpackdir, 'dir-cache-win32-sep')
  const unpackModule = require.resolve('../lib/unpack.js')
  const mkdirModule = require.resolve('../lib/mkdir.js')
  const reload = _ => {
    delete require.cache[unpackModule]
    delete require.cache[mkdirModule]
    return require(unpackModule)
  }

  process.env.TESTING_TAR_FAKE_PLATFORM = 'win32'
  const WinUnpack = reload()
  const WinUnpackSync = WinUnpack.Sync
  t.teardown(_ => {
    delete process.env.TESTING_TAR_FAKE_PLATFORM
    reload()
    rimraf.sync(base)
  })

  const setup = which => {
    const dir = base + '/' + which
    rimraf.sync(dir)
    mkdirp.sync(dir)
    return { dir: dir, dirCache: new Map(), warnings: [] }
  }

  t.test('dirCache keys use / for \\-separated entries', t => {
    const data = makeTar([
      {
        path: 'x\\y',
        type: 'Directory'
      },
      {
        path: 'x\\y\\ginkoid',
        type: 'File',
        size: 'ginkoid'.length
      },
      'ginkoid',
      '',
      ''
    ])

    const check = (t, c) => {
      t.strictSame(c.warnings, [], 'no warnings')
      t.equal(fs.statSync(c.dir + '/x/y').isDirectory(), true,
        'x/y is a directory')
      t.equal(fs.readFileSync(c.dir + '/x/y/ginkoid', 'utf8'), 'ginkoid',
        'file landed in the normalized directory')
      t.ok(c.dirCache.has(c.dir + '/x/y'),
        'dirCache key uses / separators')
      t.notOk(c.dirCache.has(c.dir + '/x\\y'),
        'no \\-separated key was left behind')
      t.end()
    }

    t.test('async', t => {
      const c = setup('keys-async')
      new WinUnpack({ cwd: c.dir, dirCache: c.dirCache })
        .on('warn', msg => c.warnings.push(msg))
        .on('end', _ => check(t, c))
        .end(data)
    })

    t.test('sync', t => {
      const c = setup('keys-sync')
      new WinUnpackSync({ cwd: c.dir, dirCache: c.dirCache })
        .on('warn', msg => c.warnings.push(msg))
        .end(data)
      check(t, c)
    })

    t.end()
  })

  t.test('prune matches across separators', t => {
    // 'x/y' is cached as a directory, then a symlink spelled 'x\\y' takes
    // its place.  Without normalization the two spellings did not match, the
    // cache entry survived, and 'x/y/ginkoid' was written through the link.
    const data = makeTar([
      {
        path: 'x/y',
        type: 'Directory'
      },
      {
        path: 'x\\y',
        type: 'SymbolicLink',
        linkpath: './z'
      },
      {
        path: 'x/y/ginkoid',
        type: 'File',
        size: 'ginkoid'.length
      },
      'ginkoid',
      '',
      ''
    ])

    const check = (t, c) => {
      t.equal(fs.lstatSync(c.dir + '/x/y').isSymbolicLink(), true,
        'the \\-separated symlink replaced x/y')
      t.notOk(c.dirCache.has(c.dir + '/x/y'),
        'poisoned dirCache entry was pruned')
      t.throws(_ => fs.readFileSync(c.dir + '/x/y/ginkoid'), { code: 'ENOENT' },
        'the file was not written through the symlink')
      t.strictSame(c.warnings, ['Cannot extract through symbolic link'])
      t.end()
    }

    t.test('async', t => {
      const c = setup('prune-async')
      new WinUnpack({ cwd: c.dir, dirCache: c.dirCache })
        .on('warn', msg => c.warnings.push(msg))
        .on('end', _ => check(t, c))
        .end(data)
    })

    t.test('sync', t => {
      const c = setup('prune-sync')
      new WinUnpackSync({ cwd: c.dir, dirCache: c.dirCache })
        .on('warn', msg => c.warnings.push(msg))
        .end(data)
      check(t, c)
    })

    t.end()
  })

  t.end()
})

// 'café' spelled with a composed é (NFC), and with a plain e followed by a
// combining acute accent (NFD).  A filesystem that squashes unicode, such as
// macOS', treats the two spellings as one and the same name.
const nfcCafe = Buffer.from([0x63, 0x61, 0x66, 0xc3, 0xa9]).toString()
const nfdCafe = Buffer.from([0x63, 0x61, 0x66, 0x65, 0xcc, 0x81]).toString()

t.test('dirCache pruning unicode normalized collisions', t => {
  // A directory entry is cached under the exact spelling the archive used, so
  // a symlink spelled the other way took the place of the cached directory
  // without pruning it.  Cache keys are compared on their maximally
  // compatible (NFKD, lowercased) representation now, so either spelling of a
  // name prunes the other.
  //
  // Note that the upstream archive's trailing '<nfc>/bar' file entry is left
  // out here: this filesystem is case sensitive and unicode transparent, so
  // that entry legitimately re-creates the pruned cache key, which would hide
  // whether the symlink entry ever pruned it.
  const base = path.resolve(unpackdir, 'dir-cache-unicode')
  t.teardown(_ => rimraf.sync(base))

  const data = makeTar([
    {
      path: 'foo',
      type: 'Directory'
    },
    {
      path: 'foo/bar',
      type: 'File',
      size: 1
    },
    'x',
    {
      path: nfcCafe,
      type: 'Directory'
    },
    {
      path: nfdCafe,
      type: 'SymbolicLink',
      linkpath: 'foo'
    },
    '',
    ''
  ])

  const setup = which => {
    const dir = base + '/' + which
    rimraf.sync(dir)
    mkdirp.sync(dir)
    return { dir: dir, dirCache: new Map(), warnings: [] }
  }

  const check = (t, c) => {
    t.strictSame(Array.from(c.dirCache.entries()), [
      [c.dir, true],
      [c.dir + '/foo', true]
    ], 'composed dirCache entry was pruned by the decomposed symlink')
    t.equal(fs.readFileSync(c.dir + '/foo/bar', 'utf8'), 'x',
      'the symlink target was left alone')
    t.strictSame(c.warnings, [], 'no warnings')
    t.end()
  }

  t.test('async', t => {
    const c = setup('async')
    new Unpack({ cwd: c.dir, dirCache: c.dirCache })
      .on('warn', msg => c.warnings.push(msg))
      .on('end', _ => check(t, c))
      .end(data)
  })

  t.test('sync', t => {
    const c = setup('sync')
    new UnpackSync({ cwd: c.dir, dirCache: c.dirCache })
      .on('warn', msg => c.warnings.push(msg))
      .end(data)
    check(t, c)
  })

  t.end()
})

t.test('unicode normalized collision cannot write through a symlink', t => {
  // A unicode-squashing filesystem cannot hold both spellings of one name, so
  // the state such a filesystem produces is set up here directly: the
  // composed spelling is a symlink on disk, while the dirCache still claims
  // that it, and a child of it, is a directory that was just created.  The
  // decomposed symlink entry has to prune those stale entries, or the
  // '<nfc>/ginkoid' entry that follows skips the symlink check and is written
  // through the link, outside of the extraction target.
  const base = path.resolve(unpackdir, 'dir-cache-unicode-symlink')
  t.teardown(_ => rimraf.sync(base))

  const data = makeTar([
    {
      path: nfdCafe,
      type: 'SymbolicLink',
      linkpath: './y'
    },
    {
      path: nfcCafe + '/ginkoid',
      type: 'File',
      size: 'ginkoid'.length
    },
    'ginkoid',
    '',
    ''
  ])

  const setup = which => {
    const dir = base + '/' + which
    rimraf.sync(dir)
    mkdirp.sync(dir + '/y')
    fs.symlinkSync('./y', dir + '/' + nfcCafe)
    // as though a Directory entry spelled <nfc> had just been created here
    return {
      dir: dir,
      dirCache: new Map([
        [dir + '/' + nfcCafe, true],
        [dir + '/' + nfcCafe + '/sub', true]
      ]),
      warnings: []
    }
  }

  const check = (t, c) => {
    t.notOk(c.dirCache.has(c.dir + '/' + nfcCafe),
      'stale unicode-variant dirCache entry was pruned')
    t.notOk(c.dirCache.has(c.dir + '/' + nfcCafe + '/sub'),
      'stale unicode-variant child dirCache entry was pruned')
    t.equal(fs.lstatSync(c.dir + '/' + nfcCafe).isSymbolicLink(), true,
      'the composed spelling is still the symlink')
    t.strictSame(fs.readdirSync(c.dir + '/y'), [],
      'nothing was written through the symlink')
    t.throws(_ => fs.readFileSync(c.dir + '/' + nfcCafe + '/ginkoid'),
      { code: 'ENOENT' }, 'the file was not created')
    t.strictSame(c.warnings, ['Cannot extract through symbolic link'])
    t.end()
  }

  t.test('async', t => {
    const c = setup('async')
    new Unpack({ cwd: c.dir, dirCache: c.dirCache })
      .on('warn', msg => c.warnings.push(msg))
      .on('end', _ => check(t, c))
      .end(data)
  })

  t.test('sync', t => {
    const c = setup('sync')
    new UnpackSync({ cwd: c.dir, dirCache: c.dirCache })
      .on('warn', msg => c.warnings.push(msg))
      .end(data)
    check(t, c)
  })

  t.end()
})

t.test('dircache prune all on windows when symlink encountered', t => {
  // On windows every name also has an 8.3 shortname alias, so there is no
  // reasonable way to tell which cached directory a symlink is about to
  // shadow.  A symlink to a directory, spelled with a shortname, would
  // otherwise evade the prune and lead to writes anywhere on the system, so
  // the whole dirCache is dropped whenever a symlink entry is seen there.
  // The platform has to be faked, because posix has no shortname aliases.
  const base = path.resolve(unpackdir, 'dir-cache-win32-symlink')
  const unpackModule = require.resolve('../lib/unpack.js')
  const mkdirModule = require.resolve('../lib/mkdir.js')
  const reload = _ => {
    delete require.cache[unpackModule]
    delete require.cache[mkdirModule]
    return require(unpackModule)
  }

  process.env.TESTING_TAR_FAKE_PLATFORM = 'win32'
  const WinUnpack = reload()
  const WinUnpackSync = WinUnpack.Sync
  t.teardown(_ => {
    delete process.env.TESTING_TAR_FAKE_PLATFORM
    reload()
    rimraf.sync(base)
  })

  const data = makeTar([
    {
      path: 'foo',
      type: 'Directory'
    },
    {
      path: 'foo/bar',
      type: 'File',
      size: 1
    },
    'x',
    {
      path: nfcCafe,
      type: 'Directory'
    },
    {
      path: nfdCafe,
      type: 'SymbolicLink',
      linkpath: 'safe/actually/but/cannot/be/too/careful'
    },
    {
      path: 'bar/baz',
      type: 'File',
      size: 1
    },
    'z',
    '',
    ''
  ])

  const setup = which => {
    const dir = base + '/' + which
    rimraf.sync(dir)
    mkdirp.sync(dir)
    return { dir: dir, dirCache: new Map(), warnings: [] }
  }

  const check = (t, c) => {
    // the symlink blew away every dirCache entry before it, so only the cwd
    // and the directory created after it are left
    t.strictSame(Array.from(c.dirCache.entries()), [
      [c.dir, true],
      [c.dir + '/bar', true]
    ], 'the whole dirCache was dropped by the symlink')
    t.equal(fs.readFileSync(c.dir + '/foo/bar', 'utf8'), 'x')
    t.equal(fs.readFileSync(c.dir + '/bar/baz', 'utf8'), 'z')
    t.strictSame(c.warnings, [], 'no warnings')
    t.end()
  }

  t.test('async', t => {
    const c = setup('async')
    new WinUnpack({ cwd: c.dir, dirCache: c.dirCache })
      .on('warn', msg => c.warnings.push(msg))
      .on('end', _ => check(t, c))
      .end(data)
  })

  t.test('sync', t => {
    const c = setup('sync')
    new WinUnpackSync({ cwd: c.dir, dirCache: c.dirCache })
      .on('warn', msg => c.warnings.push(msg))
      .end(data)
    check(t, c)
  })

  t.end()
})

t.test('excessively deep subfolder nesting', t => {
  const tf = path.resolve(fixtures, 'excessively-deep.tar')
  const data = fs.readFileSync(tf)
  const base = path.resolve(unpackdir, 'excessively-deep')
  t.teardown(_ => rimraf.sync(base))

  const warnings = []
  const onwarn = (msg, d) => warnings.push([msg, d])

  const setup = which => {
    const dir = path.resolve(base, which)
    rimraf.sync(dir)
    mkdirp.sync(dir)
    return dir
  }

  const check = (t, cwd, maxDepth) => {
    if (maxDepth === undefined)
      maxDepth = 1024
    t.match(warnings, [
      [
        'path excessively deep',
        {
          entry: ReadEntry,
          path: /^\.(\/a){1024,}\/foo.txt$/,
          depth: 222372,
          maxDepth: maxDepth
        }
      ]
    ])
    t.strictSame(fs.readdirSync(cwd), [], 'nothing was extracted')
    warnings.length = 0
    t.end()
  }

  t.test('async', t => {
    const cwd = setup('async')
    new Unpack({
      cwd: cwd,
      onwarn: onwarn
    }).on('end', _ => check(t, cwd)).end(data)
  })

  t.test('sync', t => {
    const cwd = setup('sync')
    new UnpackSync({
      cwd: cwd,
      onwarn: onwarn
    }).end(data)
    check(t, cwd)
  })

  t.test('async set md', t => {
    const cwd = setup('async-set-md')
    new Unpack({
      cwd: cwd,
      onwarn: onwarn,
      maxDepth: 64
    }).on('end', _ => check(t, cwd, 64)).end(data)
  })

  t.test('sync set md', t => {
    const cwd = setup('sync-set-md')
    new UnpackSync({
      cwd: cwd,
      onwarn: onwarn,
      maxDepth: 64
    }).end(data)
    check(t, cwd, 64)
  })

  t.end()
})

t.test('GHSA-8qq5-rm4j-mr97 linkpath sanitization', t => {
  // A link target was never sanitized at all.  An absolute hardlink target
  // defeats the path.resolve(this.cwd, entry.linkpath) in [HARDLINK],
  // because resolve ignores the cwd entirely when the linkpath is already
  // absolute, so the hardlink lands on any file on the system, and writing
  // through the extracted entry then clobbers it.  A symlink target was
  // handed to fs.symlink() verbatim, so an absolute or '..'-bearing target
  // pointed wherever it liked.  Both happened with preservePaths:false.
  //
  // The linkname field of a tar header is only 100 bytes, and the absolute
  // target has to survive the header intact, so this one test works in a
  // short directory of its own rather than under the fixtures tree
  const dir = path.resolve(os.tmpdir(), 'tar-ghsa-8qq5-rm4j-mr97')
  const secretFile = path.resolve(dir, 'secret.txt')
  t.teardown(_ => rimraf.sync(dir))

  // the cwd is a direct child of dir, so '../secret.txt' reaches the secret
  // file just as surely as its absolute path does
  const setup = which => {
    rimraf.sync(dir)
    const cwd = path.resolve(dir, which)
    mkdirp.sync(cwd)
    fs.writeFileSync(secretFile, 'ORIGINAL DATA')
    return cwd
  }

  const targetSym = '/some/absolute/path'
  const secretRoot = path.win32.parse(secretFile).root

  const data = makeTar([
    {
      path: 'exploit_hard',
      type: 'Link',
      linkpath: secretFile,
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    {
      path: 'exploit_sym',
      type: 'SymbolicLink',
      linkpath: targetSym,
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    {
      path: 'exploit_hard_dots',
      type: 'Link',
      linkpath: '../secret.txt',
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    {
      path: 'exploit_sym_dots',
      type: 'SymbolicLink',
      linkpath: '../../secret.txt',
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    {
      path: 'ok_sym',
      type: 'SymbolicLink',
      linkpath: 'inside/target',
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    '',
    ''
  ])

  const warnings = []
  const onwarn = (msg, d) => warnings.push([msg, d])

  const check = (t, cwd) => {
    // failing to link the sanitized (and now nonexistent) target is reported
    // asynchronously, so only the linkpath warnings are predictably ordered
    t.same(warnings.filter(w => /linkpath/.test(w[0])), [
      ['stripping ' + secretRoot + ' from absolute linkpath', secretFile],
      ['stripping / from absolute linkpath', targetSym],
      ['linkpath contains \'..\'', '../secret.txt'],
      ['linkpath contains \'..\'', '../../secret.txt']
    ], 'every escaping link target is stripped or rejected')

    // the absolute hardlink target is relativized, so it resolves inside the
    // extraction directory, where there is nothing to link to
    t.throws(_ => fs.lstatSync(path.resolve(cwd, 'exploit_hard')),
      'hardlink to an absolute target is not created')
    t.throws(_ => fs.lstatSync(path.resolve(cwd, 'exploit_hard_dots')),
      'hardlink to a \'..\' target is not created')
    t.throws(_ => fs.lstatSync(path.resolve(cwd, 'exploit_sym_dots')),
      'symlink to a \'..\' target is not created')

    // the absolute symlink target is relativized, so following it can only
    // ever land inside the extraction directory
    const symPath = path.resolve(cwd, 'exploit_sym')
    t.notEqual(fs.readlinkSync(symPath), targetSym,
      'symlink does not point outside the extraction directory')
    t.equal(fs.readlinkSync(symPath), targetSym.substr(1),
      'absolute symlink target is relativized')

    // an ordinary relative target is still left exactly as it was
    t.equal(fs.readlinkSync(path.resolve(cwd, 'ok_sym')), 'inside/target',
      'ordinary link target is not modified')

    // whatever did get extracted, writing to it cannot reach the secret
    const hardlinks = ['exploit_hard', 'exploit_hard_dots']
    hardlinks.forEach(f => {
      try {
        fs.writeFileSync(path.resolve(cwd, f), 'OVERWRITTEN')
      } catch (er) {}
    })
    t.equal(fs.readFileSync(secretFile, 'utf8'), 'ORIGINAL DATA',
      'no hardlink points at the secret file')

    warnings.length = 0
    t.end()
  }

  t.test('async', t => {
    const cwd = setup('async')
    new Unpack({
      cwd: cwd,
      preservePaths: false,
      onwarn: onwarn
    }).on('close', _ => check(t, cwd)).end(data)
  })

  t.test('sync', t => {
    const cwd = setup('sync')
    new UnpackSync({
      cwd: cwd,
      preservePaths: false,
      onwarn: onwarn
    }).end(data)
    check(t, cwd)
  })

  t.end()
})

t.test('no linking through a symlink', t => {
  // A link target that resolves through a symbolic link already on disk
  // lands outside of the extraction directory, even though neither the
  // entry path nor the link target contains a '..' or an absolute root for
  // the string-only checks in [CHECKPATH] to reject.  Only an lstat of each
  // part of the resolved target can catch it.
  const base = path.resolve(unpackdir, 'link-through-symlink')
  t.teardown(_ => rimraf.sync(base))

  const outside = path.resolve(base, 'outside')
  const secret = path.resolve(outside, 'secret.txt')

  // '<cwd>/x' is a real symlink out of the extraction directory, as an
  // earlier entry of the same archive or a previous extraction can leave
  // behind.  '<cwd>/realdir' is an ordinary directory, for contrast.
  const setup = which => {
    rimraf.sync(base)
    const cwd = path.resolve(base, which)
    mkdirp.sync(path.resolve(cwd, 'realdir'))
    mkdirp.sync(outside)
    fs.writeFileSync(secret, 'original content')
    fs.writeFileSync(path.resolve(cwd, 'realdir', 'target.txt'), 'inside')
    fs.symlinkSync(outside, path.resolve(cwd, 'x'))
    return cwd
  }

  const data = makeTar([
    {
      path: 'exploit_hard',
      type: 'Link',
      linkpath: 'x/secret.txt',
      mode: 0o644
    },
    {
      path: 'exploit_sym',
      type: 'SymbolicLink',
      linkpath: 'x/secret.txt',
      mode: 0o755
    },
    {
      path: 'ok_hard',
      type: 'Link',
      linkpath: 'realdir/target.txt',
      mode: 0o644
    },
    {
      path: 'ok_sym',
      type: 'SymbolicLink',
      linkpath: 'realdir/target.txt',
      mode: 0o755
    },
    '',
    ''
  ])

  const symlinkWarning = 'TAR_SYMLINK_ERROR: Cannot extract through symbolic link'

  const check = (t, cwd, warnings) => {
    t.throws(_ => fs.lstatSync(path.resolve(cwd, 'exploit_hard')),
      'hardlink through a symlinked directory is not created')
    t.throws(_ => fs.lstatSync(path.resolve(cwd, 'exploit_sym')),
      'symlink through a symlinked directory is not created')
    t.same(warnings, [symlinkWarning, symlinkWarning],
      'both escaping link entries were refused')

    // a target reached through an ordinary directory is still linked
    t.ok(fs.lstatSync(path.resolve(cwd, 'ok_hard')).isFile(),
      'hardlink through a real directory still works')
    t.ok(fs.lstatSync(path.resolve(cwd, 'ok_sym')).isSymbolicLink(),
      'symlink through a real directory still works')

    // whatever did land in the extraction dir cannot reach outside of it
    const exploits = ['exploit_hard', 'exploit_sym']
    exploits.forEach(f => {
      try {
        fs.writeFileSync(path.resolve(cwd, f), 'pwned')
      } catch (er) {}
    })
    t.equal(fs.readFileSync(secret, 'utf8'), 'original content',
      'the file outside the extraction directory is untouched')
    t.end()
  }

  t.test('async', t => {
    const warnings = []
    const cwd = setup('async')
    new Unpack({
      cwd: cwd,
      onwarn: msg => warnings.push(msg)
    }).on('close', _ => check(t, cwd, warnings)).end(data)
  })

  t.test('sync', t => {
    const warnings = []
    const cwd = setup('sync')
    new UnpackSync({
      cwd: cwd,
      onwarn: msg => warnings.push(msg)
    }).end(data)
    check(t, cwd, warnings)
  })

  t.test('preservePaths opts out', t => {
    const warnings = []
    const cwd = setup('preserve')
    new UnpackSync({
      cwd: cwd,
      preservePaths: true,
      onwarn: msg => warnings.push(msg)
    }).end(data)
    t.same(warnings, [], 'no link was refused')
    t.ok(fs.lstatSync(path.resolve(cwd, 'exploit_sym')).isSymbolicLink(),
      'symlink through the symlinked directory was created')
    t.ok(fs.lstatSync(path.resolve(cwd, 'exploit_hard')).isFile(),
      'hardlink through the symlinked directory was created')
    t.end()
  })

  t.end()
})

t.test('link through a symlinked \'..\' chain', t => {
  // The published proof of concept builds its way out of the extraction
  // directory with a pair of symlinks whose own targets contain '..', and
  // then links through the resulting chain with a target that does not.
  // The link targets carrying '..' are refused outright, so the chain is
  // never built and the final entry has nothing to follow.
  const base = path.resolve(unpackdir, 'symlink-dotdot-chain')
  t.teardown(_ => rimraf.sync(base))

  const setup = which => {
    rimraf.sync(base)
    const dir = path.resolve(base, which)
    // the cwd is a child of dir, so the chain lands back on dir itself
    const cwd = path.resolve(dir, 'x')
    mkdirp.sync(cwd)
    fs.writeFileSync(path.resolve(dir, 'exploited-file'), 'original content')
    return { dir: dir, cwd: cwd }
  }

  const makeExploit = type => makeTar([
    {
      path: 'a/b/up',
      type: 'SymbolicLink',
      linkpath: '../..',
      mode: 0o755
    },
    {
      path: 'a/b/escape',
      type: 'SymbolicLink',
      linkpath: 'up/..',
      mode: 0o755
    },
    {
      path: 'exploit',
      type: type,
      linkpath: 'a/b/escape/exploited-file',
      mode: 0o755
    },
    '',
    ''
  ])

  const check = (t, c, warnings) => {
    t.same(warnings.filter(w => /linkpath/.test(w)), [
      'linkpath contains \'..\'',
      'linkpath contains \'..\''
    ], 'both escaping symlinks were refused')
    t.throws(_ => fs.lstatSync(path.resolve(c.cwd, 'a/b/up')),
      'the first link of the chain is not created')
    t.throws(_ => fs.lstatSync(path.resolve(c.cwd, 'a/b/escape')),
      'the second link of the chain is not created')
    try {
      fs.writeFileSync(path.resolve(c.cwd, 'exploit'), 'pwned')
    } catch (er) {}
    t.equal(fs.readFileSync(path.resolve(c.dir, 'exploited-file'), 'utf8'),
      'original content', 'the file outside the extraction dir is untouched')
    t.end()
  }

  const types = ['Link', 'SymbolicLink']
  types.forEach(type => {
    t.test(type, t => {
      const exploit = makeExploit(type)

      t.test('async', t => {
        const warnings = []
        const c = setup('async-' + type)
        new Unpack({
          cwd: c.cwd,
          onwarn: msg => warnings.push(msg)
        }).on('close', _ => check(t, c, warnings)).end(exploit)
      })

      t.test('sync', t => {
        const warnings = []
        const c = setup('sync-' + type)
        new UnpackSync({
          cwd: c.cwd,
          onwarn: msg => warnings.push(msg)
        }).end(exploit)
        check(t, c, warnings)
      })

      t.end()
    })
  })

  t.end()
})

// Helper for 'numeric pax/entry name discernment' test:
// A PAX header entry with a numeric-looking path (e.g. "12345") must be
// extracted as a file named "12345", not crash or skip, in strict and non-strict.
const makePaxNameData = (paxName, entryName) => {
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

const paxNameDir = which => {
  const dir = path.resolve(unpackdir, 'numeric-pax-name-' + which)
  rimraf.sync(dir)
  mkdirp.sync(dir)
  return dir
}

for (const strict of [true, false]) {
  for (const paxName of ['12345', 'abcde']) {
    for (const entryName of ['12345', 'abcde']) {
      const label = 'numeric pax/entry name discernment strict=' + strict +
        ' paxName=' + paxName + ' entryName=' + entryName
      const which = strict + '-' + paxName + '-' + entryName
      const data = makePaxNameData(paxName, entryName)

      t.test(label + ' sync', t => {
        const cwd = paxNameDir(which + '-sync')
        t.teardown(_ => rimraf.sync(cwd))
        new UnpackSync({ strict: strict, cwd: cwd }).end(data)
        t.equal(fs.readFileSync(cwd + '/' + paxName, 'utf8'), '12345\n')
        t.end()
      })

      t.test(label + ' async', t => {
        const cwd = paxNameDir(which + '-async')
        t.teardown(_ => rimraf.sync(cwd))
        new Unpack({ strict: strict, cwd: cwd }).on('end', _ => {
          t.equal(fs.readFileSync(cwd + '/' + paxName, 'utf8'), '12345\n')
          t.end()
        }).end(data)
      })
    }
  }
}

// The advisory's proof of concept puts the all-digit pax path on a Directory
// entry, and notes that neither strict:false nor an onwarn handler can catch
// the resulting TypeError, since it is thrown synchronously while the entry
// event is being emitted.
const makePaxDirData = _ => {
  const paxData = new Pax({ path: '12345' }, false).encode()
  return makeTar([
    paxData,
    {
      type: 'Directory',
      path: 'dir',
      mode: 0o755,
      ctime: new Date('2000-01-01T00:00:00.000Z'),
      mtime: new Date('2000-01-01T00:00:00.000Z'),
      size: 0
    },
    '',
    ''
  ])
}

const paxDirData = makePaxDirData()

t.test('numeric pax path on a directory entry sync', t => {
  const cwd = paxNameDir('dir-sync')
  t.teardown(_ => rimraf.sync(cwd))
  new UnpackSync({ cwd: cwd }).end(paxDirData)
  t.ok(fs.lstatSync(cwd + '/12345').isDirectory(), 'made the directory')
  t.end()
})

t.test('numeric pax path on a directory entry async', t => {
  const cwd = paxNameDir('dir-async')
  t.teardown(_ => rimraf.sync(cwd))
  new Unpack({ cwd: cwd }).on('end', _ => {
    t.ok(fs.lstatSync(cwd + '/12345').isDirectory(), 'made the directory')
    t.end()
  }).end(paxDirData)
})

// A pax header retypes an entry's link target just as easily as its own path.
// A numeric-looking linkpath has to arrive as the string '12345', because
// every consumer of it (path.win32.parse in the '..' check, path.resolve on
// the way to fs.symlink) only accepts strings.
// Header.decode() reads linkpath out of the block *after* its own pax slurp,
// so the block still needs a placeholder target to get past parse.js'
// 'linkpath required' check; the pax value is applied by ReadEntry.
const makePaxLinkData = _ => {
  const paxData = new Pax({
    path: 'symlink',
    linkpath: '12345'
  }, false).encode()
  return makeTar([
    paxData,
    {
      type: 'SymbolicLink',
      path: 'symlink',
      linkpath: 'placeholder',
      mode: 0o755,
      ctime: new Date('2000-01-01T00:00:00.000Z'),
      mtime: new Date('2000-01-01T00:00:00.000Z'),
      size: 0
    },
    '',
    ''
  ])
}

const paxLinkData = makePaxLinkData()

t.test('numeric pax linkpath stays a string sync', t => {
  const cwd = paxNameDir('link-sync')
  t.teardown(_ => rimraf.sync(cwd))
  new UnpackSync({ cwd: cwd }).end(paxLinkData)
  t.ok(fs.lstatSync(cwd + '/symlink').isSymbolicLink(), 'got a symlink')
  t.equal(fs.readlinkSync(cwd + '/symlink'), '12345')
  t.end()
})

t.test('numeric pax linkpath stays a string async', t => {
  const cwd = paxNameDir('link-async')
  t.teardown(_ => rimraf.sync(cwd))
  new Unpack({ cwd: cwd }).on('end', _ => {
    t.ok(fs.lstatSync(cwd + '/symlink').isSymbolicLink(), 'got a symlink')
    t.equal(fs.readlinkSync(cwd + '/symlink'), '12345')
    t.end()
  }).end(paxLinkData)
})
