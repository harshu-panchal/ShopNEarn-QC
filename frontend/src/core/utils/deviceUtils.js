/**
 * Utility to detect if the app is running on a mobile device or within the Flutter WebView.
 */
export const isMobileOrWebView = () => {
  if (typeof window === "undefined") return false;
  
  return (
    window.innerWidth < 768 || 
    !!window.Flutter || 
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
  );
};
