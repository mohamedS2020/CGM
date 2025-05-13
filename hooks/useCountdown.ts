import { useState, useEffect, useRef } from 'react';

/**
 * Custom hook for creating a countdown timer
 * @param initialSeconds Initial time in seconds
 * @returns Object with countdown state and control functions
 */
export const useCountdown = (initialSeconds: number) => {
  const [countdown, setCountdown] = useState(initialSeconds);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isActiveRef = useRef(false);

  const startCountdown = () => {
    if (isActiveRef.current) return;
    
    isActiveRef.current = true;
    timerRef.current = setInterval(() => {
      setCountdown(prevCount => {
        if (prevCount <= 1) {
          stopCountdown();
          return 0;
        }
        return prevCount - 1;
      });
    }, 1000);
  };

  const stopCountdown = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    isActiveRef.current = false;
  };

  const resetCountdown = (seconds: number = initialSeconds) => {
    stopCountdown();
    setCountdown(seconds);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  return {
    countdown,
    startCountdown,
    stopCountdown,
    resetCountdown,
    isActive: isActiveRef.current
  };
}; 