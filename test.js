
const Promise = require('bluebird')
const co = Promise.coroutine
const test = require('tape')
const { utils, constants } = require('@tradle/engine')
const contexts = require('@tradle/engine/test/contexts')
const helpers = require('@tradle/engine/test/helpers')
const { SEQ, TYPE } = constants
const enforceOrder = require('./')
const TIMED_OUT = new Error('timed out')
const createFriends = Promise.promisify(contexts.nFriends)

test('basic', co(function* (t) {
  const n = 5
  const seqMap = new Map()
  const [alice, bob, carol] = yield createFriends(3)

  let lastProcessed = 0

  // make sure enforcer.receive calls return in order
  const receiveFromBob = co(function* (args) {
    const { message } = yield enforcer.receive(...args)
    t.equal(message.object[SEQ], lastProcessed++)
  })

  // make sure messages are received in order
  const [receivedAllFromBob, receivedAllFromCarol] = [bob, carol].map(node => new Promise(resolve => {
    let receivedSeq = 0
    alice.on('message', function (msg) {
      if (msg.author === node.permalink) {
        t.equal(msg.object[SEQ], receivedSeq++)
        if (receivedSeq === n) resolve()
      }
    })
  }))

  const enforcer = enforceOrder({ node: alice })
  const [fromBob, fromCarol] = yield Promise.all([bob, carol].map(node => {
    return createMessages({ node, n, to: alice.permalink })
  }))

  receiveFromBob(fromBob[0])
  try {
    yield Promise.race([
      receiveFromBob(fromBob[2]),
      new Promise((resolve, reject) => setTimeout(() => reject(TIMED_OUT), 100))
    ])

    t.fail('received a message out of order')
  } catch (err) {
    t.equal(err, TIMED_OUT)
  }

  fromCarol.forEach(args => enforcer.receive(...args))
  yield receivedAllFromCarol

  receiveFromBob(fromBob[4])
  receiveFromBob(fromBob[3])
  receiveFromBob(fromBob[1])
  yield receivedAllFromBob

  t.end()
}))

const createMessages = co(function* ({ node, to, n }) {
  return new Promise(resolve => {
    const _send = node._send
    const msgs = []
    node._send = function (msg, to, cb) {
      msgs.push([msg, { permalink: node.permalink }])
      cb()
      if (--n === 0) resolve(msgs)
    }

    for (let i = 0; i < n; i++) {
      node.signAndSend({
        to: { permalink: to },
        object: {
          [TYPE]: 'something',
          i
        }
      }, rethrow)
    }
  })
})

function rethrow (err) {
  if (err) throw err
}
