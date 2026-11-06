-- The sync now runs between one chosen playlist on each service, instead of
-- the Apple Music library and YouTube Music likes.
ALTER TABLE settings
  ADD COLUMN apple_playlist_id text,
  ADD COLUMN apple_playlist_name text,
  ADD COLUMN youtube_playlist_id text,
  ADD COLUMN youtube_playlist_name text,
  ADD COLUMN apple_playlist_remove_strategy text CHECK (apple_playlist_remove_strategy IN ('query', 'body'));

-- State and verifications from the library sync do not apply to playlists.
DELETE FROM track_links;
DELETE FROM match_results;
UPDATE settings SET mode = 'dry-run', apple_delete_verified_at = NULL, youtube_delete_verified_at = NULL;
