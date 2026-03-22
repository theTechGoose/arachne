export interface OverclockLevel {
  arm_freq: number;
  over_voltage?: number;
  over_voltage_delta?: number;
  temp_limit: number;
}

export interface OverclockProfile {
  name: string;
  temp_max: number;
  levels: OverclockLevel[];
}
