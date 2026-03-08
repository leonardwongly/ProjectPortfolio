/**
 * Analytics adapter pattern for tracking events across multiple providers.
 * Provides consistent error handling and logging for all analytics integrations.
 */

/**
 * Base analytics adapter interface.
 * All adapters should implement the track method.
 */
class AnalyticsAdapter {
  constructor(name) {
    this.name = name;
    this.enabled = true;
  }

  /**
   * Tracks an event with the analytics provider.
   * @param {string} eventName - Event name
   * @param {Object} properties - Event properties
   * @returns {Promise<void>}
   */
  async track(eventName, properties) {
    throw new Error('track() must be implemented by subclass');
  }

  /**
   * Checks if the adapter is available and ready.
   * @returns {boolean}
   */
  isAvailable() {
    return this.enabled;
  }

  /**
   * Logs adapter errors with context.
   * @param {Error} error - The error object
   * @param {string} eventName - Event name for context
   */
  logError(error, eventName) {
    console.warn(`[Analytics:${this.name}] Failed to track "${eventName}":`, error.message);
  }
}

/**
 * Google Tag Manager / Google Analytics adapter.
 */
class GTagAdapter extends AnalyticsAdapter {
  constructor() {
    super('GTag');
  }

  isAvailable() {
    return this.enabled && typeof window.gtag === 'function';
  }

  async track(eventName, properties) {
    if (!this.isAvailable()) {
      return;
    }

    try {
      window.gtag('event', eventName, properties);
    } catch (error) {
      this.logError(error, eventName);
    }
  }
}

/**
 * Google Tag Manager dataLayer adapter.
 */
class DataLayerAdapter extends AnalyticsAdapter {
  constructor() {
    super('DataLayer');
  }

  isAvailable() {
    return this.enabled && Array.isArray(window.dataLayer);
  }

  async track(eventName, properties) {
    if (!this.isAvailable()) {
      return;
    }

    try {
      window.dataLayer.push({ event: eventName, ...properties });
    } catch (error) {
      this.logError(error, eventName);
    }
  }
}

/**
 * Plausible Analytics adapter.
 */
class PlausibleAdapter extends AnalyticsAdapter {
  constructor() {
    super('Plausible');
  }

  isAvailable() {
    return this.enabled && typeof window.plausible === 'function';
  }

  async track(eventName, properties) {
    if (!this.isAvailable()) {
      return;
    }

    try {
      window.plausible(eventName, { props: properties });
    } catch (error) {
      this.logError(error, eventName);
    }
  }
}

/**
 * Custom event adapter using DOM CustomEvents.
 * Useful for testing and internal tracking.
 */
class CustomEventAdapter extends AnalyticsAdapter {
  constructor() {
    super('CustomEvent');
  }

  isAvailable() {
    return this.enabled && typeof window.dispatchEvent === 'function';
  }

  async track(eventName, properties) {
    if (!this.isAvailable()) {
      return;
    }

    try {
      window.dispatchEvent(new CustomEvent('portfolio:track', {
        detail: { event: eventName, properties }
      }));
    } catch (error) {
      this.logError(error, eventName);
    }
  }
}

/**
 * Main analytics manager that coordinates multiple adapters.
 */
class AnalyticsManager {
  constructor() {
    this.adapters = [];
    this.eventQueue = [];
    this.isReady = false;
  }

  /**
   * Registers an analytics adapter.
   * @param {AnalyticsAdapter} adapter - Analytics adapter instance
   */
  registerAdapter(adapter) {
    if (!(adapter instanceof AnalyticsAdapter)) {
      throw new Error('Adapter must extend AnalyticsAdapter');
    }

    this.adapters.push(adapter);
  }

  /**
   * Initializes all adapters and processes queued events.
   */
  initialize() {
    this.isReady = true;

    // Process queued events
    if (this.eventQueue.length > 0) {
      console.log(`[Analytics] Processing ${this.eventQueue.length} queued events`);
      this.eventQueue.forEach(({ eventName, properties }) => {
        this.track(eventName, properties);
      });
      this.eventQueue = [];
    }
  }

  /**
   * Sanitizes event properties to ensure safe values.
   * @param {Object} properties - Raw properties
   * @returns {Object} Sanitized properties
   */
  sanitizeProperties(properties) {
    const safeProperties = {};

    Object.entries(properties).forEach(([key, value]) => {
      // Validate key format
      if (typeof key !== 'string' || !/^[a-z0-9_]+$/i.test(key)) {
        return;
      }

      // Handle different value types
      if (typeof value === 'boolean' || Number.isFinite(value)) {
        safeProperties[key] = value;
        return;
      }

      if (typeof value === 'string') {
        safeProperties[key] = value.slice(0, 120);
      }
    });

    return safeProperties;
  }

  /**
   * Tracks an event across all registered adapters.
   * @param {string} eventName - Event name
   * @param {Object} properties - Event properties
   */
  track(eventName, properties = {}) {
    // Validate event name
    if (typeof eventName !== 'string' || !/^[a-z0-9_]+$/i.test(eventName)) {
      console.warn('[Analytics] Invalid event name:', eventName);
      return;
    }

    const safeProperties = this.sanitizeProperties(properties);

    // Queue events if not ready
    if (!this.isReady) {
      this.eventQueue.push({ eventName, properties: safeProperties });
      return;
    }

    // Track with all available adapters
    const availableAdapters = this.adapters.filter(adapter => adapter.isAvailable());

    if (availableAdapters.length === 0) {
      console.debug('[Analytics] No adapters available for event:', eventName);
      return;
    }

    // Execute all adapters in parallel
    Promise.all(
      availableAdapters.map(adapter => adapter.track(eventName, safeProperties))
    ).catch(error => {
      console.error('[Analytics] Unexpected error tracking event:', error);
    });
  }

  /**
   * Disables a specific adapter by name.
   * @param {string} adapterName - Name of adapter to disable
   */
  disableAdapter(adapterName) {
    const adapter = this.adapters.find(a => a.name === adapterName);
    if (adapter) {
      adapter.enabled = false;
      console.log(`[Analytics] Disabled adapter: ${adapterName}`);
    }
  }

  /**
   * Gets statistics about registered adapters.
   * @returns {Object} Adapter statistics
   */
  getStats() {
    return {
      total: this.adapters.length,
      available: this.adapters.filter(a => a.isAvailable()).length,
      queued: this.eventQueue.length,
      ready: this.isReady
    };
  }
}

// Export for use in main.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    AnalyticsManager,
    GTagAdapter,
    DataLayerAdapter,
    PlausibleAdapter,
    CustomEventAdapter
  };
}
