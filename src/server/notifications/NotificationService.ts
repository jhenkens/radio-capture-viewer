import { EventEmitter } from "events";

export interface TransmissionAvailableEvent {
  system_id: string;
  channel_id: string;
  transmission_id: string;
}

export class NotificationService extends EventEmitter {
  emitTransmissionAvailable(event: TransmissionAvailableEvent): void {
    this.emit("transmission:available", event);
  }

  onTransmissionAvailable(
    listener: (event: TransmissionAvailableEvent) => void
  ): this {
    return this.on("transmission:available", listener);
  }
}

// Singleton
let _notificationService: NotificationService | null = null;

export function getNotificationService(): NotificationService {
  if (!_notificationService) {
    _notificationService = new NotificationService();
    _notificationService.setMaxListeners(100);
  }
  return _notificationService;
}
