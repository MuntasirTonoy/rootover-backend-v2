// YouTube link normalisation (BACKEND_SPEC section 9), the only copy: the
// course editor checks links through GET /api/teacher/video-link. Accepts
// watch/share/shorts/embed URLs or a pasted <iframe> embed code; lessons always
// store the embed form.
const YOUTUBE_ID =
	/^.*(youtu.be\/|v\/|u\/\w\/|embed\/|shorts\/|watch\?v=|&v=)([^#&?"]*).*/;

export function toEmbedUrl(input: string): string | null {
	const iframeSrc = input.match(/<iframe[^>]+src=["']([^"']+)["']/i)?.[1];
	const url = (iframeSrc ?? input).trim();
	if (!/youtube\.com|youtu\.be|youtube-nocookie\.com/.test(url)) return null;
	const m = url.match(YOUTUBE_ID);
	return m && m[2].length === 11
		? `https://www.youtube.com/embed/${m[2]}`
		: null;
}
