(function () {
  /**
   * HELPERS
   */

  // Wraps functions to mimic native code in .toString()
  const forge = (fn, name) =>
    new Proxy(fn, {
      get: (target, prop) => {
        if (prop === "toString")
          return () => `function ${name || fn.name}() { [native code] }`;
        return target[prop];
      },
    });

  // Shortcut for defining getters with forge
  const mimicGetter = (obj, prop, getter, name) => {
    Object.defineProperty(obj, prop, {
      get: forge(getter, name || `get ${prop}`),
      configurable: true,
    });
  };

  // Shortcut for defining static values
  const mimicValue = (obj, prop, value) => {
    Object.defineProperty(obj, prop, {
      value,
      configurable: true,
      writable: true,
    });
  };

  /**
   * 1. NAVIGATOR IDENTITY
   */

  const chromeVersion = "132.0.6834.161";
  const uaData = {
    brands: [
      { brand: "Google Chrome", version: "132" },
      { brand: "Chromium", version: "132" },
      { brand: "Not:A-Brand", version: "24" },
    ],
    mobile: false,
    platform: "Windows",
    platformVersion: "10.0.0",
    uaFullVersion: chromeVersion,
    fullVersionList: [
      { brand: "Google Chrome", version: chromeVersion },
      { brand: "Chromium", version: chromeVersion },
      { brand: "Not:A-Brand", version: "24.0.0.0" },
    ],
  };

  mimicGetter(navigator, "userAgentData", () => ({
    ...uaData,
    getHighEntropyValues: async (hints) => {
      const data = { ...uaData };
      if (hints.includes("bitness")) data.bitness = "64";
      if (hints.includes("architecture")) data.architecture = "x86";
      return data;
    },
  }));

  mimicGetter(navigator, "platform", () => "Win32");
  mimicGetter(navigator, "vendor", () => "Google Inc.");
  mimicGetter(navigator, "product", () => "Gecko");
  mimicGetter(navigator, "productSub", () => "20030107");
  mimicGetter(navigator, "vendorSub", () => "");
  mimicGetter(navigator, "languages", () => ["en-US", "en"]);
  mimicGetter(navigator, "maxTouchPoints", () => 0);
  mimicGetter(navigator, "pdfViewerEnabled", () => true);

  /**
   * 2. BROWSER BEHAVIOR & STEALTH
   */

  // Hide automation flags
  const navProto = Object.getPrototypeOf(navigator);
  delete navProto.webdriver;
  mimicGetter(navProto, "webdriver", () => false);

  // Navigator Proxy to ensure proper binding
  const navProxy = new Proxy(navigator, {
    get: (target, prop) => {
      const val = target[prop];
      return typeof val === "function" ? val.bind(target) : val;
    },
  });
  mimicGetter(window, "navigator", () => navProxy);

  // Mock plugins
  mimicGetter(navigator, "plugins", () => {
    const p = [
      {
        name: "Chrome PDF Viewer",
        filename: "internal-pdf-viewer",
        description: "Portable Document Format",
      },
      {
        name: "Chrome PDF Plugin",
        filename: "internal-pdf-viewer",
        description: "Portable Document Format",
      },
      {
        name: "Native Client",
        filename: "internal-nacl-plugin",
        description: "",
      },
    ];
    p.refresh = () => {};
    return p;
  });

  // Mock Permissions API
  const originalQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = (params) =>
    params.name === "notifications"
      ? Promise.resolve({ state: Notification.permission })
      : originalQuery(params);

  // Mock Window features
  window.chrome = {
    app: { isInstalled: false },
    runtime: { connect: () => {}, sendMessage: () => {} },
    csi: () => ({
      startE: Date.now() - 100,
      onloadT: Date.now(),
      pageT: 100,
      tran: 15,
    }),
    loadTimes: () => ({
      requestTime: Date.now() / 1000 - 1,
      startLoadTime: Date.now() / 1000 - 1,
      commitLoadTime: Date.now() / 1000 - 0.5,
      finishDocumentLoadTime: Date.now() / 1000 - 0.2,
      finishLoadTime: Date.now() / 1000,
      firstPaintTime: Date.now() / 1000 - 0.5,
      firstPaintAfterLoadTime: 0,
      navigationType: "Other",
      wasFetchedFromCache: false,
      wasAlternateProtocolAvailable: false,
      wasCalledWithPreconnect: false,
    }),
  };

  /**
   * 3. ENVIRONMENT & HARDWARE
   */

  const screenMocks = {
    width: 1920,
    height: 1080,
    availWidth: 1920,
    availHeight: 1040,
    colorDepth: 24,
    pixelDepth: 24,
  };
  Object.entries(screenMocks).forEach(([prop, val]) =>
    mimicGetter(window.screen, prop, () => val),
  );

  const windowMocks = {
    screenX: 100,
    screenY: 100,
    screenLeft: 100,
    screenTop: 100,
    innerWidth: 1920,
    innerHeight: 1040,
    outerWidth: 1920,
    outerHeight: 1080,
    devicePixelRatio: 1,
  };
  Object.entries(windowMocks).forEach(([prop, val]) =>
    mimicGetter(window, prop, () => val),
  );

  mimicGetter(window.screen, "orientation", () => ({
    type: "landscape-primary",
    angle: 0,
  }));
  mimicGetter(document, "visibilityState", () => "visible");
  mimicGetter(document, "hidden", () => false);

  /**
   * 4. API NEUTRALIZATION
   */

  // Disable WebRTC leaks
  try {
    if (window.RTCPeerConnection) {
      window.RTCPeerConnection = forge(function () {
        return {
          createOffer: () => Promise.reject(new Error("WebRTC Disabled")),
          createAnswer: () => Promise.reject(new Error("WebRTC Disabled")),
          setLocalDescription: () => Promise.resolve(),
          setRemoteDescription: () => Promise.resolve(),
          addIceCandidate: () => Promise.resolve(),
          close: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => true,
        };
      }, "RTCPeerConnection");
    }
  } catch (e) {}

  // Neutralize WebGPU
  if (navigator.gpu) mimicGetter(navigator, "gpu", () => undefined);

  // Stealth Font detection
  try {
    const originalCheck = document.fonts.check;
    document.fonts.check = forge(function (font) {
      if (font.includes("Electron") || font.includes("Jiinashi")) return false;
      return originalCheck.apply(document.fonts, arguments);
    }, "check");
  } catch (e) {}

  console.log("[Stealth] Optimized Preload Applied.");
})();
