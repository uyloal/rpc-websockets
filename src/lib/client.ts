/**
 * "Client" wraps "ws" or a browser-implemented "WebSocket" library
 * according to the environment providing JSON RPC 2.0 support on top.
 * @module Client
 */

"use strict"

import NodeWebSocket from "ws"
import { EventEmitter } from "eventemitter3"
import {
    ICommonWebSocket,
    IWSClientAdditionalOptions,
    NodeWebSocketType,
    ICommonWebSocketFactory,
} from "./client/client.types.js"

import { DataPack, DefaultDataPack } from "./utils.js"

interface IQueueElement {
  promise: [
    Parameters<ConstructorParameters<typeof Promise>[0]>[0],
    Parameters<ConstructorParameters<typeof Promise>[0]>[1]
  ];
  timeout?: ReturnType<typeof setTimeout>;
}

export interface IQueue {
  [x: number]: IQueueElement;
}

export interface IWSRequestParams {
  [x: string]: any;
  [x: number]: any;
}

export class CommonClient extends EventEmitter
{
    private address: string
    private rpc_id: number
    private queue: IQueue
    private options: IWSClientAdditionalOptions & NodeWebSocket.ClientOptions
    private autoconnect: boolean
    private ready: boolean
    private reconnect: boolean
    private reconnect_timer_id: NodeJS.Timeout
    private reconnect_interval: number
    private max_reconnects: number
    private rest_options: IWSClientAdditionalOptions &
    NodeWebSocket.ClientOptions
    private current_reconnects: number
    private generate_request_id: (
    method: string,
    params: object | Array<any>
  ) => number
    private socket: ICommonWebSocket
    private webSocketFactory: ICommonWebSocketFactory
    private dataPack: DataPack<object, string>

    /**
   * Instantiate a Client class.
   * @constructor
   * @param {webSocketFactory} webSocketFactory - factory method for WebSocket
   * @param {String} address - url to a websocket server
   * @param {Object} options - ws options object with reconnect parameters
   * @param {Function} generate_request_id - custom generation request Id
   * @param {DataPack} dataPack - data pack contains encoder and decoder
   * @return {CommonClient}
   */
    constructor(
        webSocketFactory: ICommonWebSocketFactory,
        address = "ws://localhost:8080",
        {
            autoconnect = true,
            reconnect = true,
            reconnect_interval = 1000,
            max_reconnects = 5,
            ...rest_options
        } = {},
        generate_request_id?: (
      method: string,
      params: object | Array<any>
    ) => number,
        dataPack?: DataPack<object, string>
    )
    {
        super()

        this.webSocketFactory = webSocketFactory

        this.queue = {}
        this.rpc_id = 0

        this.address = address
        this.autoconnect = autoconnect
        this.ready = false
        this.reconnect = reconnect
        this.reconnect_timer_id = undefined
        this.reconnect_interval = reconnect_interval
        this.max_reconnects = max_reconnects
        this.rest_options = rest_options
        this.current_reconnects = 0
        this.generate_request_id = generate_request_id || (() => ++this.rpc_id)

        if (!dataPack) this.dataPack = new DefaultDataPack()
        else this.dataPack = dataPack

        if (this.autoconnect)
            this._connect(this.address, {
                autoconnect: this.autoconnect,
                reconnect: this.reconnect,
                reconnect_interval: this.reconnect_interval,
                max_reconnects: this.max_reconnects,
                ...this.rest_options,
            })
    }

    /**
   * Connects to a defined server if not connected already.
   * @method
   * @return {Undefined}
   */
    connect()
    {
        if (this.socket) return

        this._connect(this.address, {
            autoconnect: this.autoconnect,
            reconnect: this.reconnect,
            reconnect_interval: this.reconnect_interval,
            max_reconnects: this.max_reconnects,
            ...this.rest_options,
        })
    }

    /**
   * Calls a registered RPC method on server.
   * @method
   * @param {String} method - RPC method name
   * @param {Object|Array} params - optional method parameters
   * @param {Number} timeout - RPC reply timeout value
   * @param {Object} ws_opts - options passed to ws
   * @return {Promise}
   */
    call(
        method: string,
        params?: IWSRequestParams,
        timeout?: number,
        ws_opts?: Parameters<NodeWebSocketType["send"]>[1]
    )
    {
        if (!ws_opts && "object" === typeof timeout)
        {
            ws_opts = timeout
            timeout = null
        }

        return new Promise((resolve, reject) =>
        {
            if (!this.ready) return reject(new Error("socket not ready"))

            const rpc_id = this.generate_request_id(method, params)

            const message = {
                jsonrpc: "2.0",
                method: method,
                params: params || undefined,
                id: rpc_id,
            }

            this.socket.send(this.dataPack.encode(message), ws_opts, (error) =>
            {
                if (error) return reject(error)

                this.queue[rpc_id] = { promise: [resolve, reject] }

                if (timeout)
                {
                    this.queue[rpc_id].timeout = setTimeout(() =>
                    {
                        delete this.queue[rpc_id]
                        reject(new Error("reply timeout"))
                    }, timeout)
                }
            })
        })
    }

    /**
   * Logins with the other side of the connection.
   * @method
   * @param {Object} params - Login credentials object
   * @return {Promise}
   */
    async login(params: IWSRequestParams)
    {
        const resp = await this.call("rpc.login", params)

        if (!resp) throw new Error("authentication failed")

        return resp
    }

    /**
   * Fetches a list of client's methods registered on server.
   * @method
   * @return {Array}
   */
    async listMethods()
    {
        return await this.call("__listMethods")
    }

    /**
   * Sends a JSON-RPC 2.0 notification to server.
   * @method
   * @param {String} method - RPC method name
   * @param {Object} params - optional method parameters
   * @return {Promise}
   */
    notify(method: string, params?: IWSRequestParams)
    {
        return new Promise<void>((resolve, reject) =>
        {
            if (!this.ready) return reject(new Error("socket not ready"))

            const message = {
                jsonrpc: "2.0",
                method: method,
                params,
            }

            this.socket.send(this.dataPack.encode(message), (error) =>
            {
                if (error) return reject(error)

                resolve()
            })
        })
    }

    /**
   * Subscribes for a defined event.
   * @method
   * @param {String|Array} event - event name
   * @return {Undefined}
   * @throws {Error}
   */
    async subscribe(event: string | Array<string>)
    {
        if (typeof event === "string") event = [event]

        const result = await this.call("rpc.on", event)

        if (typeof event === "string" && result[event] !== "ok")
            throw new Error(
                "Failed subscribing to an event '" + event + "' with: " + result[event]
            )

        return result
    }

    /**
   * Unsubscribes from a defined event.
   * @method
   * @param {String|Array} event - event name
   * @return {Undefined}
   * @throws {Error}
   */
    async unsubscribe(event: string | Array<string>)
    {
        if (typeof event === "string") event = [event]

        const result = await this.call("rpc.off", event)

        if (typeof event === "string" && result[event] !== "ok")
            throw new Error("Failed unsubscribing from an event with: " + result)

        return result
    }

    /**
   * Closes a WebSocket connection gracefully.
   * @method
   * @param {Number} code - socket close code
   * @param {String} data - optional data to be sent before closing
   * @return {Undefined}
   */
    close(code?: number, data?: string)
    {
        this.socket.close(code || 1000, data)
    }

    /**
   * Enable / disable automatic reconnection.
   * @method
   * @param {Boolean} reconnect - enable / disable reconnection
   * @return {Undefined}
   */
    setAutoReconnect(reconnect: boolean)
    {
        this.reconnect = reconnect
    }

    /**
   * Set the interval between reconnection attempts.
   * @method
   * @param {Number} interval - reconnection interval in milliseconds
   * @return {Undefined}
   */
    setReconnectInterval(interval: number)
    {
        this.reconnect_interval = interval
    }

    /**
   * Set the maximum number of reconnection attempts.
   * @method
   * @param {Number} max_reconnects - maximum reconnection attempts
   * @return {Undefined}
   */
    setMaxReconnects(max_reconnects: number)
    {
        this.max_reconnects = max_reconnects
    }

    /**
   * Connection/Message handler.
   * @method
   * @private
   * @param {String} address - WebSocket API address
   * @param {Object} options - ws options object
   * @return {Undefined}
   */
    private _connect(
        address: string,
        options: IWSClientAdditionalOptions & NodeWebSocket.ClientOptions
    )
    {
        clearTimeout(this.reconnect_timer_id)
        this.socket = this.webSocketFactory(address, options)

        this.socket.addEventListener("open", () =>
        {
            this.ready = true
            this.emit("open")
            this.current_reconnects = 0
        })

        this.socket.addEventListener("message", ({ data: message }) =>
        {
            if (message instanceof ArrayBuffer)
                message = Buffer.from(message).toString()

            try
            {
                message = this.dataPack.decode(message)
            }
            catch (error)
            {
                return
            }

            // check if any listeners are attached and forward event
            if (message.notification && this.listeners(message.notification).length)
            {
                if (!Object.keys(message.params).length)
                    return this.emit(message.notification)

                const args = [message.notification]

                if (message.params.constructor === Object) args.push(message.params)
                // using for-loop instead of unshift/spread because performance is better
                else
                    for (let i = 0; i < message.params.length; i++)
                        args.push(message.params[i])

                // run as microtask so that pending queue messages are resolved first
                // eslint-disable-next-line prefer-spread
                return Promise.resolve().then(() =>
                {
                    // eslint-disable-next-line prefer-spread
                    this.emit.apply(this, args)
                })
            }

            if (!this.queue[message.id])
            {
                // general JSON RPC 2.0 events
                if (message.method)
                {
                    // run as microtask so that pending queue messages are resolved first
                    return Promise.resolve().then(() =>
                    {
                        this.emit(message.method, message?.params)
                    })
                }

                return
            }

            // reject early since server's response is invalid
            if ("error" in message === "result" in message)
                this.queue[message.id].promise[1](
                    new Error(
                        "Server response malformed. Response must include either \"result\"" +
              " or \"error\", but not both."
                    )
                )

            if (this.queue[message.id].timeout)
                clearTimeout(this.queue[message.id].timeout)

            if (message.error) this.queue[message.id].promise[1](message.error)
            else this.queue[message.id].promise[0](message.result)

            delete this.queue[message.id]
        })

        this.socket.addEventListener("error", (error) => this.emit("error", error))

        this.socket.addEventListener("close", ({ code, reason }) =>
        {
            if (this.ready)
            // Delay close event until internal state is updated
                setTimeout(() => this.emit("close", code, reason), 0)

            this.ready = false
            this.socket = undefined

            if (code === 1000) return

            this.current_reconnects++

            if (
                this.reconnect &&
        (this.max_reconnects > this.current_reconnects ||
          this.max_reconnects === 0)
            )
                this.reconnect_timer_id = setTimeout(
                    () => this._connect(address, options),
                    this.reconnect_interval
                )
        })
    }
}
