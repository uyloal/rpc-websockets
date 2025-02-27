'use strict';

var WebSocketImpl = require('ws');
var eventemitter3 = require('eventemitter3');
var url = require('url');
var uuid = require('uuid');

function _interopDefault (e) { return e && e.__esModule ? e : { default: e }; }

var WebSocketImpl__default = /*#__PURE__*/_interopDefault(WebSocketImpl);
var url__default = /*#__PURE__*/_interopDefault(url);

// src/lib/client/websocket.ts
function WebSocket(address, options) {
  return new WebSocketImpl__default.default(address, options);
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
var CommonClient = class extends eventemitter3.EventEmitter {
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
var Server = class extends eventemitter3.EventEmitter {
  namespaces;
  dataPack;
  wss;
  /**
  * Instantiate a Server class.
  * @constructor
  * @param {Object} options - ws constructor's parameters with rpc
  * @param {DataPack} dataPack - data pack contains encoder and decoder
  * @return {Server} - returns a new Server instance
  */
  constructor(options, dataPack) {
    super();
    this.namespaces = {};
    if (!dataPack) this.dataPack = new DefaultDataPack();
    else this.dataPack = dataPack;
    this.wss = new WebSocketImpl.WebSocketServer(options);
    this.wss.on("listening", () => this.emit("listening"));
    this.wss.on("connection", (socket, request) => {
      const u = url__default.default.parse(request.url, true);
      const ns = u.pathname;
      if (u.query.socket_id) socket._id = u.query.socket_id;
      else socket._id = uuid.v1();
      socket["_authenticated"] = false;
      socket.on("error", (error) => this.emit("socket-error", socket, error));
      socket.on("close", () => {
        this.namespaces[ns].clients.delete(socket._id);
        for (const event of Object.keys(this.namespaces[ns].events)) {
          const index = this.namespaces[ns].events[event].sockets.indexOf(
            socket._id
          );
          if (index >= 0)
            this.namespaces[ns].events[event].sockets.splice(index, 1);
        }
        this.emit("disconnection", socket);
      });
      if (!this.namespaces[ns]) this._generateNamespace(ns);
      this.namespaces[ns].clients.set(socket._id, socket);
      this.emit("connection", socket, request);
      return this._handleRPC(socket, ns);
    });
    this.wss.on("error", (error) => this.emit("error", error));
  }
  /**
  * Registers an RPC method.
  * @method
  * @param {String} name - method name
  * @param {Function} fn - a callee function
  * @param {String} ns - namespace identifier
  * @throws {TypeError}
  * @return {Object} - returns an IMethod object
  */
  register(name, fn, ns = "/") {
    if (!this.namespaces[ns]) this._generateNamespace(ns);
    this.namespaces[ns].rpc_methods[name] = {
      fn,
      protected: false
    };
    return {
      protected: () => this._makeProtectedMethod(name, ns),
      public: () => this._makePublicMethod(name, ns)
    };
  }
  /**
  * Sets an auth method.
  * @method
  * @param {Function} fn - an arbitrary auth method
  * @param {String} ns - namespace identifier
  * @throws {TypeError}
  * @return {Undefined}
  */
  setAuth(fn, ns = "/") {
    this.register("rpc.login", fn, ns);
  }
  /**
  * Marks an RPC method as protected.
  * @method
  * @param {String} name - method name
  * @param {String} ns - namespace identifier
  * @return {Undefined}
  */
  _makeProtectedMethod(name, ns = "/") {
    this.namespaces[ns].rpc_methods[name].protected = true;
  }
  /**
  * Marks an RPC method as public.
  * @method
  * @param {String} name - method name
  * @param {String} ns - namespace identifier
  * @return {Undefined}
  */
  _makePublicMethod(name, ns = "/") {
    this.namespaces[ns].rpc_methods[name].protected = false;
  }
  /**
  * Marks an event as protected.
  * @method
  * @param {String} name - event name
  * @param {String} ns - namespace identifier
  * @return {Undefined}
  */
  _makeProtectedEvent(name, ns = "/") {
    this.namespaces[ns].events[name].protected = true;
  }
  /**
  * Marks an event as public.
  * @method
  * @param {String} name - event name
  * @param {String} ns - namespace identifier
  * @return {Undefined}
  */
  _makePublicEvent(name, ns = "/") {
    this.namespaces[ns].events[name].protected = false;
  }
  /**
  * Removes a namespace and closes all connections
  * @method
  * @param {String} ns - namespace identifier
  * @throws {TypeError}
  * @return {Undefined}
  */
  closeNamespace(ns) {
    const namespace = this.namespaces[ns];
    if (namespace) {
      delete namespace.rpc_methods;
      delete namespace.events;
      for (const socket of namespace.clients.values()) socket.close();
      delete this.namespaces[ns];
    }
  }
  /**
  * Creates a new event that can be emitted to clients.
  * @method
  * @param {String} name - event name
  * @param {String} ns - namespace identifier
  * @throws {TypeError}
  * @return {Object} - returns an IEvent object
  */
  event(name, ns = "/") {
    if (!this.namespaces[ns]) this._generateNamespace(ns);
    else {
      const index = this.namespaces[ns].events[name];
      if (index !== void 0)
        throw new Error(`Already registered event ${ns}${name}`);
    }
    this.namespaces[ns].events[name] = {
      sockets: [],
      protected: false
    };
    this.on(name, (...params) => {
      if (params.length === 1 && params[0] instanceof Object)
        params = params[0];
      for (const socket_id of this.namespaces[ns].events[name].sockets) {
        const socket = this.namespaces[ns].clients.get(socket_id);
        if (!socket) continue;
        socket.send(
          this.dataPack.encode({
            notification: name,
            params
          })
        );
      }
    });
    return {
      protected: () => this._makeProtectedEvent(name, ns),
      public: () => this._makePublicEvent(name, ns)
    };
  }
  /**
  * Returns a requested namespace object
  * @method
  * @param {String} name - namespace identifier
  * @throws {TypeError}
  * @return {Object} - namespace object
  */
  of(name) {
    if (!this.namespaces[name]) this._generateNamespace(name);
    const self = this;
    return {
      // self.register convenience method
      register(fn_name, fn) {
        if (arguments.length !== 2)
          throw new Error("must provide exactly two arguments");
        if (typeof fn_name !== "string")
          throw new Error("name must be a string");
        if (typeof fn !== "function")
          throw new Error("handler must be a function");
        return self.register(fn_name, fn, name);
      },
      // self.event convenience method
      event(ev_name) {
        if (arguments.length !== 1)
          throw new Error("must provide exactly one argument");
        if (typeof ev_name !== "string")
          throw new Error("name must be a string");
        return self.event(ev_name, name);
      },
      // self.eventList convenience method
      get eventList() {
        return Object.keys(self.namespaces[name].events);
      },
      /**
      * Emits a specified event to this namespace.
      * @inner
      * @method
      * @param {String} event - event name
      * @param {Array} params - event parameters
      * @return {Undefined}
      */
      emit(event, ...params) {
        const socket_ids = [...self.namespaces[name].clients.keys()];
        for (let i = 0, id; id = socket_ids[i]; ++i) {
          self.namespaces[name].clients.get(id).send(
            self.dataPack.encode({
              notification: event,
              params: params || []
            })
          );
        }
      },
      /**
      * Returns a name of this namespace.
      * @inner
      * @method
      * @kind constant
      * @return {String}
      */
      get name() {
        return name;
      },
      /**
      * Returns a hash of websocket objects connected to this namespace.
      * @inner
      * @method
      * @return {Object}
      */
      connected() {
        const socket_ids = [...self.namespaces[name].clients.keys()];
        return socket_ids.reduce(
          (acc, curr) => ({
            ...acc,
            [curr]: self.namespaces[name].clients.get(curr)
          }),
          {}
        );
      },
      /**
      * Returns a list of client unique identifiers connected to this namespace.
      * @inner
      * @method
      * @return {Array}
      */
      clients() {
        return self.namespaces[name];
      }
    };
  }
  /**
  * Lists all created events in a given namespace. Defaults to "/".
  * @method
  * @param {String} ns - namespaces identifier
  * @readonly
  * @return {Array} - returns a list of created events
  */
  eventList(ns = "/") {
    if (!this.namespaces[ns]) return [];
    return Object.keys(this.namespaces[ns].events);
  }
  /**
  * Creates a JSON-RPC 2.0 compliant error
  * @method
  * @param {Number} code - indicates the error type that occurred
  * @param {String} message - provides a short description of the error
  * @param {String|Object} data - details containing additional information about the error
  * @return {Object}
  */
  createError(code, message, data) {
    return {
      code,
      message,
      data: data || null
    };
  }
  /**
  * Closes the server and terminates all clients.
  * @method
  * @return {Promise}
  */
  close() {
    return new Promise((resolve, reject) => {
      try {
        this.wss.close();
        this.emit("close");
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }
  /**
  * Handles all WebSocket JSON RPC 2.0 requests.
  * @private
  * @param {Object} socket - ws socket instance
  * @param {String} ns - namespaces identifier
  * @return {Undefined}
  */
  _handleRPC(socket, ns = "/") {
    socket.on("message", async (data) => {
      const msg_options = {};
      if (data instanceof ArrayBuffer) {
        msg_options.binary = true;
        data = Buffer.from(data).toString();
      }
      if (socket.readyState !== 1) return;
      let parsedData;
      try {
        parsedData = this.dataPack.decode(data);
      } catch (error) {
        return socket.send(
          this.dataPack.encode({
            jsonrpc: "2.0",
            error: createError(-32700, error.toString()),
            id: null
          }),
          msg_options
        );
      }
      if (Array.isArray(parsedData)) {
        if (!parsedData.length)
          return socket.send(
            this.dataPack.encode({
              jsonrpc: "2.0",
              error: createError(-32600, "Invalid array"),
              id: null
            }),
            msg_options
          );
        const responses = [];
        for (const message of parsedData) {
          const response2 = await this._runMethod(message, socket._id, ns);
          if (!response2) continue;
          responses.push(response2);
        }
        if (!responses.length) return;
        return socket.send(this.dataPack.encode(responses), msg_options);
      }
      const response = await this._runMethod(parsedData, socket._id, ns);
      if (!response) return;
      return socket.send(this.dataPack.encode(response), msg_options);
    });
  }
  /**
  * Runs a defined RPC method.
  * @private
  * @param {Object} message - a message received
  * @param {Object} socket_id - user's socket id
  * @param {String} ns - namespaces identifier
  * @return {Object|undefined}
  */
  async _runMethod(message, socket_id, ns = "/") {
    if (typeof message !== "object" || message === null)
      return {
        jsonrpc: "2.0",
        error: createError(-32600),
        id: null
      };
    if (message.jsonrpc !== "2.0")
      return {
        jsonrpc: "2.0",
        error: createError(-32600, "Invalid JSON RPC version"),
        id: message.id || null
      };
    if (!message.method)
      return {
        jsonrpc: "2.0",
        error: createError(-32602, "Method not specified"),
        id: message.id || null
      };
    if (typeof message.method !== "string")
      return {
        jsonrpc: "2.0",
        error: createError(-32600, "Invalid method name"),
        id: message.id || null
      };
    if (message.params && typeof message.params === "string")
      return {
        jsonrpc: "2.0",
        error: createError(-32600),
        id: message.id || null
      };
    if (message.method === "rpc.on") {
      if (!message.params)
        return {
          jsonrpc: "2.0",
          error: createError(-32e3),
          id: message.id || null
        };
      const results = {};
      const event_names = Object.keys(this.namespaces[ns].events);
      for (const name of message.params) {
        const index = event_names.indexOf(name);
        const namespace = this.namespaces[ns];
        if (index === -1) {
          results[name] = "provided event invalid";
          continue;
        }
        if (namespace.events[event_names[index]].protected === true && namespace.clients.get(socket_id)["_authenticated"] === false) {
          return {
            jsonrpc: "2.0",
            error: createError(-32606),
            id: message.id || null
          };
        }
        const socket_index = namespace.events[event_names[index]].sockets.indexOf(socket_id);
        if (socket_index >= 0) {
          results[name] = "socket has already been subscribed to event";
          continue;
        }
        namespace.events[event_names[index]].sockets.push(socket_id);
        results[name] = "ok";
      }
      return {
        jsonrpc: "2.0",
        result: results,
        id: message.id || null
      };
    } else if (message.method === "rpc.off") {
      if (!message.params)
        return {
          jsonrpc: "2.0",
          error: createError(-32e3),
          id: message.id || null
        };
      const results = {};
      for (const name of message.params) {
        if (!this.namespaces[ns].events[name]) {
          results[name] = "provided event invalid";
          continue;
        }
        const index = this.namespaces[ns].events[name].sockets.indexOf(socket_id);
        if (index === -1) {
          results[name] = "not subscribed";
          continue;
        }
        this.namespaces[ns].events[name].sockets.splice(index, 1);
        results[name] = "ok";
      }
      return {
        jsonrpc: "2.0",
        result: results,
        id: message.id || null
      };
    } else if (message.method === "rpc.login") {
      if (!message.params)
        return {
          jsonrpc: "2.0",
          error: createError(-32604),
          id: message.id || null
        };
    }
    if (!this.namespaces[ns].rpc_methods[message.method]) {
      return {
        jsonrpc: "2.0",
        error: createError(-32601),
        id: message.id || null
      };
    }
    let response = null;
    if (this.namespaces[ns].rpc_methods[message.method].protected === true && this.namespaces[ns].clients.get(socket_id)["_authenticated"] === false) {
      return {
        jsonrpc: "2.0",
        error: createError(-32605),
        id: message.id || null
      };
    }
    try {
      response = await this.namespaces[ns].rpc_methods[message.method].fn(
        message.params,
        socket_id
      );
    } catch (error) {
      if (!message.id) return;
      if (error instanceof Error)
        return {
          jsonrpc: "2.0",
          error: {
            code: -32e3,
            message: error.name,
            data: error.message
          },
          id: message.id
        };
      return {
        jsonrpc: "2.0",
        error,
        id: message.id
      };
    }
    if (!message.id) return;
    if (message.method === "rpc.login" && response === true) {
      const s = this.namespaces[ns].clients.get(socket_id);
      s["_authenticated"] = true;
      this.namespaces[ns].clients.set(socket_id, s);
    }
    return {
      jsonrpc: "2.0",
      result: response,
      id: message.id
    };
  }
  /**
  * Generate a new namespace store.
  * Also preregister some special namespace methods.
  * @private
  * @param {String} name - namespaces identifier
  * @return {undefined}
  */
  _generateNamespace(name) {
    this.namespaces[name] = {
      rpc_methods: {
        __listMethods: {
          fn: () => Object.keys(this.namespaces[name].rpc_methods),
          protected: false
        }
      },
      clients: /* @__PURE__ */ new Map(),
      events: {}
    };
  }
};
var RPC_ERRORS = /* @__PURE__ */ new Map([
  [-32e3, "Event not provided"],
  [-32600, "Invalid Request"],
  [-32601, "Method not found"],
  [-32602, "Invalid params"],
  [-32603, "Internal error"],
  [-32604, "Params not found"],
  [-32605, "Method forbidden"],
  [-32606, "Event forbidden"],
  [-32700, "Parse error"]
]);
function createError(code, details) {
  const error = {
    code,
    message: RPC_ERRORS.get(code) || "Internal Server Error"
  };
  if (details) error["data"] = details;
  return error;
}

// src/index.ts
var Client = class extends CommonClient {
  constructor(address = "ws://localhost:8080", {
    autoconnect = true,
    reconnect = true,
    reconnect_interval = 1e3,
    max_reconnects = 5,
    ...rest_options
  } = {}, generate_request_id) {
    super(
      WebSocket,
      address,
      {
        autoconnect,
        reconnect,
        reconnect_interval,
        max_reconnects,
        ...rest_options
      },
      generate_request_id
    );
  }
};

exports.Client = Client;
exports.CommonClient = CommonClient;
exports.DefaultDataPack = DefaultDataPack;
exports.Server = Server;
exports.WebSocket = WebSocket;
exports.createError = createError;
//# sourceMappingURL=out.js.map
//# sourceMappingURL=index.cjs.map