import websocket = require('websocket');
const W3CWebSocket = websocket['w3cwebsocket'];

import {
  SUBSCRIPTION_FAIL,
  SUBSCRIPTION_DATA,
  SUBSCRIPTION_START,
  SUBSCRIPTION_SUCCESS,
  SUBSCRIPTION_END,
} from './messageTypes';

import {
  isString,
  isObject,
} from 'lodash';

export interface SubscriptionOptions {
  query: string;
  variables?: Object;
  operationName?: string;
}

const DEFAULT_SUBSCRIPTION_TIMEOUT = 5000;

export default class Client {

  public client: any;
  public subscriptionHandlers: {[id: string]: (error, result) => void};
  private maxId: number;
  private subscriptionTimeout: number;
  private waitingSubscriptions: {[id: string]: boolean}; // subscriptions waiting for SUBSCRIPTION_SUCCESS

  constructor(url: string, options?: { timeout: number }) {

    this.client = new W3CWebSocket(url, 'graphql-subscriptions');
    this.subscriptionHandlers = {}; // id: handler
    this.maxId = 0;
    this.subscriptionTimeout = (options && options.timeout) || DEFAULT_SUBSCRIPTION_TIMEOUT;
    this.waitingSubscriptions = {};

    this.client.onmessage = (message) => {
      let parsedMessage;
      try {
        parsedMessage = JSON.parse(message.data);
      } catch (e) {
        throw new Error('Message must be JSON-parseable.');
      }
      const subId = parsedMessage.id;
      if (!this.subscriptionHandlers[subId]) {
        this.unsubscribe(subId);
        return;
      }

      // console.log('MSG', JSON.stringify(parsedMessage, null, 2));
      switch (parsedMessage.type) {

        case SUBSCRIPTION_SUCCESS:
          delete this.waitingSubscriptions[subId];

          break;
        case SUBSCRIPTION_FAIL:
          if (this.subscriptionHandlers[subId]) {
            this.subscriptionHandlers[subId](parsedMessage.errors, null);
          }
          delete this.subscriptionHandlers[subId];
          delete this.waitingSubscriptions[subId];

          break;
        case SUBSCRIPTION_DATA:
          if (parsedMessage.payload.data && !parsedMessage.payload.errors) {
              this.subscriptionHandlers[subId](null, parsedMessage.payload.data);
          } else {
            this.subscriptionHandlers[subId](parsedMessage.payload.errors, null);
          }
          break;

        default:
          throw new Error('Invalid message type - must be of type `subscription_start` or `subscription_data`.');
      }

    };
  }

  public subscribe(options: SubscriptionOptions, handler) {
    const { query, variables, operationName } = options;

    if (!query) {
      throw new Error('Must provide `query` to subscribe.');
    }

    if (!handler) {
      throw new Error('Must provide `handler` to subscribe.');
    }

    
    if (
      !isString(query) || 
      ( operationName && !isString(operationName)) || 
      ( variables && !isObject(variables))
    ) {
      throw new Error('Incorrect option types to subscribe. `subscription` must be a string,' +
      '`operationName` must be a string, and `variables` must be an object.');
    }

    switch (this.client.readyState) {

      case this.client.OPEN:
        const subId = this.generateSubscriptionId();
        let message = Object.assign(options, {type: SUBSCRIPTION_START, id: subId});
        this.sendMessage(message);
        this.subscriptionHandlers[subId] = handler;
        this.waitingSubscriptions[subId] = true;
        setTimeout( () => {
          if (this.waitingSubscriptions[subId]){
            handler(new Error('Subscription timed out - no response from server'));
            this.unsubscribe(subId);
          }
        }, this.subscriptionTimeout);
        return subId;

      case this.client.CONNECTING:
        throw new Error('Client is still connecting to websocket.');

      case this.client.CLOSING:
        throw new Error('Client websocket connection is closing.');

      case this.client.CLOSED:
        throw new Error('Client is not connected to a websocket.');

      default:
        throw new Error('Client is not connected to a websocket.');
    }
  }

  public unsubscribe(id) {
    delete this.subscriptionHandlers[id];
    if (this.client.readyState === this.client.OPEN) {
        let message = { id: id, type: SUBSCRIPTION_END};
        this.sendMessage(message);
    }
  }

  public unsubscribeAll() {
    Object.keys(this.subscriptionHandlers).forEach( subId => {
      this.unsubscribe(subId);
    });
  }

  private sendMessage(message) {
    if (this.client.readyState === this.client.OPEN) {
      this.client.send(JSON.stringify(message));
    } else {
      throw new Error('Cannot send message. WebSocket connection is not open');
    }
  }

  private generateSubscriptionId() {
    const id = this.maxId;
    this.maxId += 1;
    return id;
  }

};