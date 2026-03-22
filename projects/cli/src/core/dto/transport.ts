export type Transport = "usb" | "wifi";

export interface Conn {
  transport: Transport;
  host: string;
  port: string;
}

export interface Flags {
  viaUsb?: boolean;
  viaWifi?: boolean;
}

export interface Network {
  id: string;
  ssid: string;
  current: boolean;
}

export interface SshConfig {
  user: string;
  keyPath: string;
  connectTimeout: number;
}
