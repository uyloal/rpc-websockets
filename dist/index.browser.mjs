import { Buffer } from 'buffer';
import { EventEmitter } from 'eventemitter3';

// node_modules/esbuild-plugin-polyfill-node/polyfills/buffer.js
var WebSocketBrowserImpl = class extends EventEmitter {
  socket;
  /** Instantiate a WebSocket class
  * @constructor
  * @param {String} address - url to a websocket server
  * @param {(Object)} options - websocket options
  * @param {(String|Array)} protocols - a list of protocols
  * @return {WebSocketBrowserImpl} - returns a WebSocket instance
  */
  constructor(address, options, protocols) {
    super();
    this.socket = new window.WebSocket(address, protocols);
    this.socket.onopen = () => this.emit("open");
    this.socket.onmessage = (event) => this.emit("message", event.data);
    this.socket.onerror = (error) => this.emit("error", error);
    this.socket.onclose = (event) => {
      this.emit("close", event.code, event.reason);
    };
  }
  /**
  * Sends data through a websocket connection
  * @method
  * @param {(String|Object)} data - data to be sent via websocket
  * @param {Object} optionsOrCallback - ws options
  * @param {Function} callback - a callback called once the data is sent
  * @return {Undefined}
  */
  send(data, optionsOrCallback, callback) {
    const cb = callback || optionsOrCallback;
    try {
      this.socket.send(data);
      cb();
    } catch (error) {
      cb(error);
    }
  }
  /**
  * Closes an underlying socket
  * @method
  * @param {Number} code - status code explaining why the connection is being closed
  * @param {String} reason - a description why the connection is closing
  * @return {Undefined}
  * @throws {Error}
  */
  close(code, reason) {
    this.socket.close(code, reason);
  }
  addEventListener(type, listener, options) {
    this.socket.addEventListener(type, listener, options);
  }
};
function WebSocket(address, options) {
  return new WebSocketBrowserImpl(address, options);
}

// src/lib/utils.ts
var DefaultDataPack = class {
  encode(value) {
    return JSON.stringify(value);
  }
  decode(value) {
    return JSON.parse(value);
  }
};

// src/lib/client.ts
var CommonClient = class extends EventEmitter {
  address;
  rpc_id;
  queue;
  options;
  autoconnect;
  ready;
  reconnect;
  reconnect_timer_id;
  reconnect_interval;
  max_reconnects;
  rest_options;
  current_reconnects;
  generate_request_id;
  socket;
  webSocketFactory;
  dataPack;
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
  constructor(webSocketFactory, address = "ws://localhost:8080", {
    autoconnect = true,
    reconnect = true,
    reconnect_interval = 1e3,
    max_reconnects = 5,
    ...rest_options
  } = {}, generate_request_id, dataPack) {
    super();
    this.webSocketFactory = webSocketFactory;
    this.queue = {};
    this.rpc_id = 0;
    this.address = address;
    this.autoconnect = autoconnect;
    this.ready = false;
    this.reconnect = reconnect;
    this.reconnect_timer_id = void 0;
    this.reconnect_interval = reconnect_interval;
    this.max_reconnects = max_reconnects;
    this.rest_options = rest_options;
    this.current_reconnects = 0;
    this.generate_request_id = generate_request_id || (() => ++this.rpc_id);
    if (!dataPack) this.dataPack = new DefaultDataPack();
    else this.dataPack = dataPack;
    if (this.autoconnect)
      this._connect(this.address, {
        autoconnect: this.autoconnect,
        reconnect: this.reconnect,
        reconnect_interval: this.reconnect_interval,
        max_reconnects: this.max_reconnects,
        ...this.rest_options
      });
  }
  /**
  * Connects to a defined server if not connected already.
  * @method
  * @return {Undefined}
  */
  connect() {
    if (this.socket) return;
    this._connect(this.address, {
      autoconnect: this.autoconnect,
      reconnect: this.reconnect,
      reconnect_interval: this.reconnect_interval,
      max_reconnects: this.max_reconnects,
      ...this.rest_options
    });
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
  call(method, params, timeout, ws_opts) {
    if (!ws_opts && "object" === typeof timeout) {
      ws_opts = timeout;
      timeout = null;
    }
    return new Promise((resolve, reject) => {
      if (!this.ready) return reject(new Error("socket not ready"));
      const rpc_id = this.generate_request_id(method, params);
      const message = {
        jsonrpc: "2.0",
        method,
        params: params || void 0,
        id: rpc_id
      };
      this.socket.send(this.dataPack.encode(message), ws_opts, (error) => {
        if (error) return reject(error);
        this.queue[rpc_id] = { promise: [resolve, reject] };
        if (timeout) {
          this.queue[rpc_id].timeout = setTimeout(() => {
            delete this.queue[rpc_id];
            reject(new Error("reply timeout"));
          }, timeout);
        }
      });
    });
  }
  /**
  * Logins with the other side of the connection.
  * @method
  * @param {Object} params - Login credentials object
  * @return {Promise}
  */
  async login(params) {
    const resp = await this.call("rpc.login", params);
    if (!resp) throw new Error("authentication failed");
    return resp;
  }
  /**
  * Fetches a list of client's methods registered on server.
  * @method
  * @return {Array}
  */
  async listMethods() {
    return await this.call("__listMethods");
  }
  /**
  * Sends a JSON-RPC 2.0 notification to server.
  * @method
  * @param {String} method - RPC method name
  * @param {Object} params - optional method parameters
  * @return {Promise}
  */
  notify(method, params) {
    return new Promise((resolve, reject) => {
      if (!this.ready) return reject(new Error("socket not ready"));
      const message = {
        jsonrpc: "2.0",
        method,
        params
      };
      this.socket.send(this.dataPack.encode(message), (error) => {
        if (error) return reject(error);
        resolve();
      });
    });
  }
  /**
  * Subscribes for a defined event.
  * @method
  * @param {String|Array} event - event name
  * @return {Undefined}
  * @throws {Error}
  */
  async subscribe(event) {
    if (typeof event === "string") event = [event];
    const result = await this.call("rpc.on", event);
    if (typeof event === "string" && result[event] !== "ok")
      throw new Error(
        "Failed subscribing to an event '" + event + "' with: " + result[event]
      );
    return result;
  }
  /**
  * Unsubscribes from a defined event.
  * @method
  * @param {String|Array} event - event name
  * @return {Undefined}
  * @throws {Error}
  */
  async unsubscribe(event) {
    if (typeof event === "string") event = [event];
    const result = await this.call("rpc.off", event);
    if (typeof event === "string" && result[event] !== "ok")
      throw new Error("Failed unsubscribing from an event with: " + result);
    return result;
  }
  /**
  * Closes a WebSocket connection gracefully.
  * @method
  * @param {Number} code - socket close code
  * @param {String} data - optional data to be sent before closing
  * @return {Undefined}
  */
  close(code, data) {
    this.socket.close(code || 1e3, data);
  }
  /**
  * Enable / disable automatic reconnection.
  * @method
  * @param {Boolean} reconnect - enable / disable reconnection
  * @return {Undefined}
  */
  setAutoReconnect(reconnect) {
    this.reconnect = reconnect;
  }
  /**
  * Set the interval between reconnection attempts.
  * @method
  * @param {Number} interval - reconnection interval in milliseconds
  * @return {Undefined}
  */
  setReconnectInterval(interval) {
    this.reconnect_interval = interval;
  }
  /**
  * Set the maximum number of reconnection attempts.
  * @method
  * @param {Number} max_reconnects - maximum reconnection attempts
  * @return {Undefined}
  */
  setMaxReconnects(max_reconnects) {
    this.max_reconnects = max_reconnects;
  }
  /**
  * Connection/Message handler.
  * @method
  * @private
  * @param {String} address - WebSocket API address
  * @param {Object} options - ws options object
  * @return {Undefined}
  */
  _connect(address, options) {
    clearTimeout(this.reconnect_timer_id);
    this.socket = this.webSocketFactory(address, options);
    this.socket.addEventListener("open", () => {
      this.ready = true;
      this.emit("open");
      this.current_reconnects = 0;
    });
    this.socket.addEventListener("message", ({ data: message }) => {
      if (message instanceof ArrayBuffer)
        message = Buffer.from(message).toString();
      try {
        message = this.dataPack.decode(message);
      } catch (error) {
        return;
      }
      if (message.notification && this.listeners(message.notification).length) {
        if (!Object.keys(message.params).length)
          return this.emit(message.notification);
        const args = [message.notification];
        if (message.params.constructor === Object) args.push(message.params);
        else
          for (let i = 0; i < message.params.length; i++)
            args.push(message.params[i]);
        return Promise.resolve().then(() => {
          this.emit.apply(this, args);
        });
      }
      if (!this.queue[message.id]) {
        if (message.method) {
          return Promise.resolve().then(() => {
            this.emit(message.method, message?.params);
          });
        }
        return;
      }
      if ("error" in message === "result" in message)
        this.queue[message.id].promise[1](
          new Error(
            'Server response malformed. Response must include either "result" or "error", but not both.'
          )
        );
      if (this.queue[message.id].timeout)
        clearTimeout(this.queue[message.id].timeout);
      if (message.error) this.queue[message.id].promise[1](message.error);
      else this.queue[message.id].promise[0](message.result);
      delete this.queue[message.id];
    });
    this.socket.addEventListener("error", (error) => this.emit("error", error));
    this.socket.addEventListener("close", ({ code, reason }) => {
      if (this.ready)
        setTimeout(() => this.emit("close", code, reason), 0);
      this.ready = false;
      this.socket = void 0;
      if (code === 1e3) return;
      this.current_reconnects++;
      if (this.reconnect && (this.max_reconnects > this.current_reconnects || this.max_reconnects === 0))
        this.reconnect_timer_id = setTimeout(
          () => this._connect(address, options),
          this.reconnect_interval
        );
    });
  }
};

// src/index.browser.ts
var Client = class extends CommonClient {
  constructor(address = "ws://localhost:8080", {
    autoconnect = true,
    reconnect = true,
    reconnect_interval = 1e3,
    max_reconnects = 5
  } = {}, generate_request_id) {
    super(
      WebSocket,
      address,
      {
        autoconnect,
        reconnect,
        reconnect_interval,
        max_reconnects
      },
      generate_request_id
    );
  }
};

export { Client, CommonClient, DefaultDataPack, WebSocket };
//# sourceMappingURL=out.js.map
//# sourceMappingURL=index.browser.mjs.map