import { configureSharedSubunitLogger, createLogger} from "../../../utils/src/index.ts"

import { LOG_FILENAME } from "./plugin-identity"

const logger = createLogger({ logFileName: LOG_FILENAME })

export const log = logger.log

configureSharedSubunitLogger(log)

