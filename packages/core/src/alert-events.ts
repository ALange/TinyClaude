import { EventEmitter } from "node:events";

export type AlertEvt = {
	type: "alert";
	payload: import("@tinyclaude/types").AlertEvent;
};

class AlertEventBus extends EventEmitter {}
export const alertEvents = new AlertEventBus();

alertEvents.setMaxListeners(200);
