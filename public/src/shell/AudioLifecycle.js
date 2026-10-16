/** Coordinates browser visibility and shell pause state with a game's audio
 * implementation. Prevents loops/music continuing behind pause menus or after
 * tab blur without forcing a specific WebAudio implementation. */
export class AudioLifecycleCoordinator {
    audio;
    pauseOnHidden;
    pauseOnGamePause;
    hidden = false;
    gamePaused = false;
    suspended = false;
    detachVisibility = null;
    constructor(audio, options = {}) {
        this.audio = audio;
        this.pauseOnHidden = options.pauseOnHidden !== false;
        this.pauseOnGamePause = options.pauseOnGamePause !== false;
    }
    installVisibility(documentRef = typeof document !== "undefined" ? document : undefined) {
        this.detachVisibility?.();
        if (!documentRef)
            return () => { };
        const onChange = () => { this.hidden = documentRef.hidden; this.sync(); };
        documentRef.addEventListener("visibilitychange", onChange);
        onChange();
        const detach = () => documentRef.removeEventListener("visibilitychange", onChange);
        this.detachVisibility = detach;
        return detach;
    }
    setGamePaused(paused) { this.gamePaused = paused; this.sync(); }
    dispose() { this.detachVisibility?.(); this.detachVisibility = null; this.hidden = false; this.gamePaused = false; if (this.suspended) {
        this.audio.resumeAll?.();
        this.suspended = false;
    } }
    sync() {
        const shouldSuspend = (this.pauseOnHidden && this.hidden) || (this.pauseOnGamePause && this.gamePaused);
        if (shouldSuspend === this.suspended)
            return;
        this.suspended = shouldSuspend;
        if (shouldSuspend)
            this.audio.pauseAll?.();
        else
            this.audio.resumeAll?.();
    }
}
