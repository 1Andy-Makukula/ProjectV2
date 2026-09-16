/**
 * The welcome film, in one place.
 *
 * Its own module because two surfaces show it — the welcome screen and the
 * trust anchor at the top of the storefront — and a video URL duplicated across
 * two files is a video URL that gets replaced in one of them.
 *
 * PLACEHOLDER: Big Buck Bunny, Blender Foundation, CC-BY 3.0. A short clip
 * hosted for exactly this purpose. Replace both constants with the real film
 * and its still frame; nothing else needs to change.
 */
export const WELCOME_VIDEO =
  'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4';

/** Empty until there is a real still. The player falls back to a black frame. */
export const WELCOME_POSTER = '';
