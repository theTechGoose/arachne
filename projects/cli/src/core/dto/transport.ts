export interface Conn {
  host: string;
  port: string;
}

export interface SshConfig {
  user: string;
  keyPath: string;
  connectTimeout: number;
}
