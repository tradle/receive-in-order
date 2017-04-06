const { EventEmitter } = require('events')
const Promise = require('bluebird')
const co = Promise.coroutine
const collect = Promise.promisify(require('stream-collector'))
const { utils, constants } = require('@tradle/engine')
const { unserializeMessage } = utils
const { SEQ } = constants
const THE_SEQ_BEFORE_TIME = -1

module.exports = function enforceReceiveOrder ({ node }) {
  const lastSeq = new Map()
  const doReceive = Promise.promisify(node.receive.bind(node))
  const ee = new EventEmitter()
  const getNextSeq = co(function* ({ sender }) {
    let last = lastSeq.get(sender)
    if (typeof last === 'number') {
      return last + 1
    }

    const results = yield collect(node.objects.seq({
      limit: 1,
      reverse: true,
      from: sender,
      to: node.permalink
    }))

    last = results.length ? results[0] : THE_SEQ_BEFORE_TIME
    lastSeq.set(sender, last)
    return last + 1
  })

  const waitForSeq = co(function* ({ sender, seq }) {
    if (seq === THE_SEQ_BEFORE_TIME) return

    const expected = yield getNextSeq({ sender })
    if (expected >= seq) return

    ee.emit('missing', {
      range: [expected, seq - 1],
      from: sender
    })

    yield new Promise(resolve => {
      ee.once(getReceivedEventName({ sender, seq: seq - 1 }), resolve)
    })
  })

  function getReceivedEventName ({ sender, seq }) {
    return `${sender}:${seq}`
  }

  ee.receive = co(function* (msg, from) {
    if (Buffer.isBuffer(msg)) {
      msg = unserializeMessage(msg)
    }

    const sender = from.permalink
    const seq = msg[SEQ]
    yield waitForSeq({ sender, seq })
    const ret = yield doReceive(msg, from)
    lastSeq.set(sender, seq)
    ee.emit(getReceivedEventName({ sender, seq }))
    return ret
  })

  return ee
}
