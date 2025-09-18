(function (globalScope) {
  const LEVEL_ORDER = { debug: 0, info: 1, warn: 2, error: 3 };
  const KNOWN_LEVELS = Object.keys(LEVEL_ORDER);
  let globalLevel = 'debug';

  function sanitizeScope(scope) {
    if (!scope) return 'app';
    if (typeof scope !== 'string') return String(scope);
    return scope.trim() || 'app';
  }

  function resolveLevel(level) {
    if (!level) return globalLevel;
    const normalized = String(level).toLowerCase();
    return LEVEL_ORDER.hasOwnProperty(normalized) ? normalized : globalLevel;
  }

  function shouldLog(level) {
    const levelKey = resolveLevel(level);
    return LEVEL_ORDER[levelKey] >= LEVEL_ORDER[globalLevel];
  }

  function getConsoleMethod(level) {
    switch (level) {
      case 'debug':
        return console.debug ? console.debug.bind(console) : console.log.bind(console);
      case 'info':
        return console.info ? console.info.bind(console) : console.log.bind(console);
      case 'warn':
        return console.warn ? console.warn.bind(console) : console.log.bind(console);
      case 'error':
        return console.error ? console.error.bind(console) : console.log.bind(console);
      default:
        return console.log.bind(console);
    }
  }

  function toMessageParts(message, args) {
    if (args.length === 0) return [message];
    return [message, ...args];
  }

  function createScopedLogger(scope, options = {}) {
    const loggerScope = sanitizeScope(scope);
    const localLevel = resolveLevel(options.level);
    const denied = new Set((Array.isArray(options.denyList) ? options.denyList : [options.denyList]).filter(Boolean).map(sanitizeScope));

    function log(level, message, ...args) {
      const targetLevel = resolveLevel(level);
      if (!shouldLog(targetLevel) || LEVEL_ORDER[targetLevel] < LEVEL_ORDER[localLevel]) return;
      if (denied.has(loggerScope)) return;

      const timestamp = new Date().toISOString();
      const prefix = `[${timestamp}] [${loggerScope}] [${targetLevel.toUpperCase()}]`;
      getConsoleMethod(targetLevel)(prefix, ...toMessageParts(message, args));
    }

    function startTimer(label) {
      const timerLabel = `${loggerScope}:${label}`;
      const start = performance && performance.now ? performance.now() : Date.now();
      return {
        end(success = true, details) {
          const end = performance && performance.now ? performance.now() : Date.now();
          const duration = Math.round(end - start);
          const suffix = success ? 'completed' : 'failed';
          log(success ? 'info' : 'error', `${label} ${suffix} in ${duration}ms`, details || {});
        }
      };
    }

    return {
      debug: (msg, ...args) => log('debug', msg, ...args),
      info: (msg, ...args) => log('info', msg, ...args),
      warn: (msg, ...args) => log('warn', msg, ...args),
      error: (msg, ...args) => log('error', msg, ...args),
      log,
      child(suffix) {
        return createScopedLogger(`${loggerScope}:${sanitizeScope(suffix)}`, options);
      },
      time: startTimer
    };
  }

  Object.assign(createScopedLogger, {
    setLevel(level) {
      const resolved = resolveLevel(level);
      globalLevel = resolved;
      getConsoleMethod('info')(`[logger] Log level set to ${resolved}`);
    },
    getLevel() {
      return globalLevel;
    },
    levels: Object.freeze([...KNOWN_LEVELS])
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = createScopedLogger;
  } else {
    globalScope.createScopedLogger = createScopedLogger;
  }
})(typeof self !== 'undefined' ? self : typeof global !== 'undefined' ? global : this);
