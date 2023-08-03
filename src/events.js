import ready from './events/ready.js'
import playerUpdate from './events/playerUpdate.js'
import stats from './events/stats.js'
import trackStart from './events/event/trackStart.js'
import trackEnd from './events/event/trackEnd.js'
import trackException from './events/event/trackException.js'
import trackStuck from './events/event/trackStuck.js'
import websocketClosed from './events/event/websocketClosed.js'

import index from '../index.js'

function handle(Event, payload, node, config, Nodes, Players) {
  let temp = { Nodes, Players }

  switch (payload.op) {
    case 'ready': {
      temp.Nodes = ready(Event, payload, node, config, Nodes, Players)

      break
    }

    case 'playerUpdate': {
      playerUpdate(Event, payload, node, config, Nodes)

      break
    }

    case 'stats': {
      temp.Nodes = stats(Event, payload, node, config, Nodes, Players)

      break
    }

    case 'event': {
      switch (payload.type) {
        case 'TrackStartEvent': {
          temp.Players = trackStart(Event, payload, node, config, Nodes, Players)
        
          break
        }

        case 'TrackEndEvent': {
          temp.Players = trackEnd(Event, payload, node, config, Nodes, Players)

          break
        }

        case 'TrackExceptionEvent': {
          temp.Players = trackException(Event, payload, node, config, Nodes, Players)

          break
        }

        case 'TrackStuckEvent': {
          temp.Players = trackStuck(Event, payload, node, config, Nodes, Players)

          break
        }

        case 'WebSocketClosedEvent': {
          temp.Players = websocketClosed(Event, payload, node, config, Nodes, Players)

          break
        }
      }
    }
  }

  return temp
}

function open(node, config, Nodes) {
  if (config.debug) console.log(`[FastLink] Connected to ${node}`)

  return Nodes
}

function message(Event, data, node, config, Nodes, Players) {
  const payload = JSON.parse(data)

  Event.emit('raw', payload)

  return handle(Event, payload, node, config, Nodes, Players)
}

function close(Event, ws, node, config, Nodes, Players) {
  if (config.debug) console.log(`[FastLink] Disconnected from ${node.hostname}`)

  Nodes[node.hostname] = null
  
  Object.keys(Players).forEach((key) => {
    if (Players[key].node == node.hostname)
      delete Players[key]
  })

  setTimeout(() => {
    index.node.connectNodes([ node ], config)
  }, 5000)

  return { Nodes, Players, ws }
}

function error(err, node, config, Nodes) {
  if (config.debug) console.log(`[FastLink] Error from ${node}: ${err}`)

  return Nodes
}

export default {
  handle,
  open,
  message,
  close,
  error
}