/** Fetch local media before transport starts. Game simulation and rendering stay offline. */
export async function loadAudioStem(context, src) {
    if (!src.startsWith('./audio/') && !src.startsWith('/audio/'))
        throw Error('Stem must be a local /audio/ asset');
    const response = await fetch(src);
    if (!response.ok)
        throw Error(`${src}: HTTP ${response.status}`);
    return context.decodeAudioData(await response.arrayBuffer());
}
