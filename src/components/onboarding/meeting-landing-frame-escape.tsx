"use client";

import { useEffect } from "react";

export function MeetingLandingFrameEscape() {
  useEffect(() => {
    if (window.top && window.top !== window.self) {
      window.top.location.replace(window.location.href);
    }
  }, []);

  return null;
}
