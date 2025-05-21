
// src/lib/helpers.ts

/**
 * Plays a beep sound using the Web Audio API.
 * @param frequency The frequency of the beep in Hz (default: 660Hz - A5 note).
 * @param duration The duration of the beep in milliseconds (default: 150ms).
 * @returns A function to clear any pending timeouts related to closing the AudioContext.
 */
export const playBeep = (frequency = 660, duration = 150): (() => void) => {
    if (typeof window !== 'undefined' && (window.AudioContext || (window as any).webkitAudioContext)) {
       try {
            const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();

            oscillator.type = 'sine'; // Standard beep sound
            oscillator.frequency.setValueAtTime(frequency, audioCtx.currentTime); // Frequency in Hz
            gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime); // Start with moderate volume
            // Fade out quickly
            gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration / 1000);

            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);

            oscillator.start(audioCtx.currentTime);
            oscillator.stop(audioCtx.currentTime + duration / 1000);

            // Close the AudioContext after the sound finishes playing to free up resources
            const closeTimeout = setTimeout(() => {
                audioCtx.close().catch(err => console.warn("Error closing AudioContext:", err));
            }, duration + 100); // Add a small buffer before closing

            // Return a cleanup function to clear the timeout if the component unmounts
            return () => clearTimeout(closeTimeout);

       } catch (error: any) {
            // Ignore NotAllowedError which often happens if user hasn't interacted with the page yet
            if (error.name === 'NotAllowedError') {
                console.warn("AudioContext playback prevented by browser policy (user interaction likely required).");
            } else {
                console.error("Error playing beep sound:", error);
            }
       }
   } else {
       console.warn("AudioContext not supported by this browser. Cannot play beep sound.");
   }
   // Return an empty cleanup function if AudioContext is not supported or fails
   return () => {};
 };

    
