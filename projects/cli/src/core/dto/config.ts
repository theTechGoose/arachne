export interface NgrokConfig {
  tcp: string;
  http: string;
  httpAuth?: string[];
}

export interface PiEntry {
  ngrok?: NgrokConfig;
}

export type Config = Record<string, PiEntry>;
