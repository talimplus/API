// This project runs in CommonJS mode; default imports for dayjs/plugins can be undefined at runtime.
// `import = require()` is the safest option here.
import dayjsLib = require('dayjs');
import utc = require('dayjs/plugin/utc');
import timezone = require('dayjs/plugin/timezone');

dayjsLib.extend(utc);
dayjsLib.extend(timezone);

export const dayjs = dayjsLib;


