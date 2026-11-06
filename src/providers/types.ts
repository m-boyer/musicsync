export type Service = 'apple' | 'youtube';

export interface Track {
  /** Apple catalog id or YouTube video id: the id used to add the song and to link it. */
  id: string;
  /** Apple library id, which differs from the catalog id and is needed to remove the song. */
  removeId?: string;
  title: string;
  artist: string;
  durationMs?: number;
}

export interface ReadResult {
  tracks: Track[];
  /** False when the service may have more songs than were returned. */
  complete: boolean;
}

export interface MusicProvider {
  readonly service: Service;
  read(): Promise<ReadResult>;
  search(track: Track): Promise<Track[]>;
  add(track: Track): Promise<void>;
  remove(track: Track): Promise<void>;
}

export interface PlaylistInfo {
  id: string;
  name: string;
}

/** Lists and creates the playlists the sync can use. */
export interface PlaylistDirectory {
  list(): Promise<PlaylistInfo[]>;
  create(name: string): Promise<PlaylistInfo>;
  /** Whether a playlist accepts changes from this account. */
  isEditable(id: string): Promise<boolean>;
}
