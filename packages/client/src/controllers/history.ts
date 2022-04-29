import { formatJsonRpcRequest, isJsonRpcError } from "@walletconnect/jsonrpc-utils";
import { generateChildLogger, getLoggerContext } from "@walletconnect/logger";
import { IJsonRpcHistory, JsonRpcRecord, RequestEvent, ICore } from "@walletconnect/types";
import { ERROR } from "@walletconnect/utils";
import { EventEmitter } from "events";
import { Logger } from "pino";
import {
  CLIENT_STORAGE_PREFIX,
  HISTORY_CONTEXT,
  HISTORY_EVENTS,
  HISTORY_STORAGE_VERSION,
} from "../constants";

export class JsonRpcHistory extends IJsonRpcHistory {
  public records = new Map<number, JsonRpcRecord>();
  public events = new EventEmitter();
  public name = HISTORY_CONTEXT;
  public version = HISTORY_STORAGE_VERSION;
  private cached: JsonRpcRecord[] = [];

  private storagePrefix = CLIENT_STORAGE_PREFIX;

  constructor(public core: ICore, public logger: Logger) {
    super(core, logger);
    this.logger = generateChildLogger(logger, this.name);
    this.registerEventListeners();
  }

  public init: IJsonRpcHistory["init"] = async () => {
    this.logger.trace(`Initialized`);
    await this.initialize();
  };

  get context(): string {
    return getLoggerContext(this.logger);
  }

  get storageKey(): string {
    return this.storagePrefix + this.version + "//" + this.name;
  }

  get size(): number {
    return this.records.size;
  }

  get keys(): number[] {
    return Array.from(this.records.keys());
  }

  get values() {
    return Array.from(this.records.values());
  }

  get pending(): RequestEvent[] {
    const requests: RequestEvent[] = [];
    this.values.forEach(record => {
      if (typeof record.response !== "undefined") return;
      const requestEvent: RequestEvent = {
        topic: record.topic,
        request: formatJsonRpcRequest(record.request.method, record.request.params, record.id),
        chainId: record.chainId,
      };
      return requests.push(requestEvent);
    });
    return requests;
  }

  public set: IJsonRpcHistory["set"] = async (topic, request, chainId) => {
    await this.isInitialized();
    this.logger.debug(`Setting JSON-RPC request history record`);
    this.logger.trace({ type: "method", method: "set", topic, request, chainId });
    if (this.records.has(request.id)) return;
    const record: JsonRpcRecord = {
      id: request.id,
      topic,
      request: { method: request.method, params: request.params || null },
      chainId,
    };
    this.records.set(record.id, record);
    this.events.emit(HISTORY_EVENTS.created, record);
  };

  public resolve: IJsonRpcHistory["resolve"] = async response => {
    await this.isInitialized();
    this.logger.debug(`Updating JSON-RPC response history record`);
    this.logger.trace({ type: "method", method: "update", response });
    if (!this.records.has(response.id)) return;
    const record = await this.getRecord(response.id);
    if (typeof record.response !== "undefined") return;
    record.response = isJsonRpcError(response)
      ? { error: response.error }
      : { result: response.result };
    this.records.set(record.id, record);
    this.events.emit(HISTORY_EVENTS.updated, record);
  };

  public get: IJsonRpcHistory["get"] = async (topic, id) => {
    await this.isInitialized();
    this.logger.debug(`Getting record`);
    this.logger.trace({ type: "method", method: "get", topic, id });
    const record = await this.getRecord(id);
    if (record.topic !== topic) {
      const error = ERROR.MISMATCHED_TOPIC.format({
        context: this.name,
        id,
      });
      // silencing this for now
      // this.logger.error(error.message);
      throw new Error(error.message);
    }
    return record;
  };

  public delete: IJsonRpcHistory["delete"] = async (topic, id) => {
    await this.isInitialized();
    this.logger.debug(`Deleting record`);
    this.logger.trace({ type: "method", method: "delete", id });
    this.values.forEach((record: JsonRpcRecord) => {
      if (record.topic === topic) {
        if (typeof id !== "undefined" && record.id !== id) return;
        this.records.delete(record.id);
        this.events.emit(HISTORY_EVENTS.deleted, record);
      }
    });
  };

  public exists: IJsonRpcHistory["exists"] = async (topic, id) => {
    await this.isInitialized();
    if (!this.records.has(id)) return false;
    const record = await this.getRecord(id);
    return record.topic === topic;
  };

  public on: IJsonRpcHistory["on"] = (event, listener) => {
    this.events.on(event, listener);
  };

  public once: IJsonRpcHistory["once"] = (event, listener) => {
    this.events.once(event, listener);
  };

  public off: IJsonRpcHistory["off"] = (event, listener) => {
    this.events.off(event, listener);
  };

  public removeListener: IJsonRpcHistory["removeListener"] = (event, listener) => {
    this.events.removeListener(event, listener);
  };

  // ---------- Private ----------------------------------------------- //

  private async setJsonRpcRecords(records: JsonRpcRecord[]): Promise<void> {
    await this.core.storage.setItem<JsonRpcRecord[]>(this.storageKey, records);
  }

  private async getJsonRpcRecords(): Promise<JsonRpcRecord[] | undefined> {
    const records = await this.core.storage.getItem<JsonRpcRecord[]>(this.storageKey);
    return records;
  }

  private async getRecord(id: number): Promise<JsonRpcRecord> {
    await this.isInitialized();
    const record = this.records.get(id);
    if (!record) {
      const error = ERROR.NO_MATCHING_ID.format({
        context: this.name,
        id,
      });
      // silencing this for now
      // this.logger.error(error.message);
      throw new Error(error.message);
    }
    return record;
  }

  private async persist() {
    await this.setJsonRpcRecords(this.values);
    this.events.emit(HISTORY_EVENTS.sync);
  }

  private async restore() {
    try {
      const persisted = await this.getJsonRpcRecords();
      if (typeof persisted === "undefined") return;
      if (!persisted.length) return;
      if (this.records.size) {
        const error = ERROR.RESTORE_WILL_OVERRIDE.format({
          context: this.name,
        });
        this.logger.error(error.message);
        throw new Error(error.message);
      }
      this.cached = persisted;
      this.logger.debug(`Successfully Restored records for ${this.name}`);
      this.logger.trace({ type: "method", method: "restore", records: this.values });
    } catch (e) {
      this.logger.debug(`Failed to Restore records for ${this.name}`);
      this.logger.error(e as any);
    }
  }

  private async initialize() {
    await this.restore();
    this.reset();
    this.onInit();
  }

  private reset() {
    this.cached.forEach(record => this.records.set(record.id, record));
  }

  private onInit() {
    this.cached = [];
    this.events.emit(HISTORY_EVENTS.init);
  }

  private async isInitialized(): Promise<void> {
    if (!this.cached.length) return;
    return new Promise(resolve => {
      this.events.once(HISTORY_EVENTS.init, () => resolve());
    });
  }

  private registerEventListeners(): void {
    this.events.on(HISTORY_EVENTS.created, (record: JsonRpcRecord) => {
      const eventName = HISTORY_EVENTS.created;
      this.logger.info(`Emitting ${eventName}`);
      this.logger.debug({ type: "event", event: eventName, record });
      this.persist();
    });
    this.events.on(HISTORY_EVENTS.updated, (record: JsonRpcRecord) => {
      const eventName = HISTORY_EVENTS.updated;
      this.logger.info(`Emitting ${eventName}`);
      this.logger.debug({ type: "event", event: eventName, record });
      this.persist();
    });

    this.events.on(HISTORY_EVENTS.deleted, (record: JsonRpcRecord) => {
      const eventName = HISTORY_EVENTS.deleted;
      this.logger.info(`Emitting ${eventName}`);
      this.logger.debug({ type: "event", event: eventName, record });
      this.persist();
    });
  }
}
