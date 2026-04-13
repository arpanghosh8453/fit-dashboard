export type Activity = {
  id: number;
  file_name: string;
  activity_name: string;
  sport: string;
  device: string;
  start_ts_utc: string;
  end_ts_utc: string;
  duration_s: number;
  distance_m: number;
};

export type RecordPoint = {
  timestamp_ms: number;
  latitude?: number;
  longitude?: number;
  altitude_m?: number;
  distance_m?: number;
  speed_m_s?: number;
  heart_rate?: number;
  cadence?: number;
  power?: number;
  temperature_c?: number;
};

export type OverviewStats = {
  activity_count: number;
  total_distance_m: number;
  total_duration_s: number;
};
