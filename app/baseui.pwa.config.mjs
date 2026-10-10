export default {
  manifest: { name: "aPuppet Web Administrator", shortName: "aPuppet", description: "Open source web application to access Android devices remotely (remote support program)", themeColor: "#0f172a" },
  serviceWorker: {
    cacheName: "apuppet-web-admin-v4",
    cdnVersion: "1.1.2",
    appFiles: ["app.css", "app.js", "app.xml", "static/images/favicon.ico", "icons/icon-192.png", "icons/icon-512.png"],
  },
};
