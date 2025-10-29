# Tasks Document

- [ ] 1. Environment setup and dependency installation
  - File: `package.json` (in `claude-code-router` environment)
  - Add `@byjohann/toon` dependency to the `claude-code-router` project environment (or user plugin environment)
  - Purpose: Ensure `toon.encode` function can be called by custom transformer
  - _Leverage: `npm install @byjohann/toon`_
  - _Requirements: 1, 2_
  - _Prompt: Role: Developer | Task: Install `@byjohann/toon` library into `claude-code-router` dependencies | Restrictions: Must use npm or pnpm | Success: `toon` library successfully installed and can be `require` or `import`_

- [ ] 2. Create `ToonTransformer.js` transformer class
  - File: `~/.claude-code-router/plugins/toon-transformer.js` (or other path chosen by user)
  - Implement a JavaScript/TypeScript class (e.g., `ToonTransformer`) that includes `constructor`, `name` property and `transformRequestIn` method
  - Purpose: Establish transformer foundation to comply with `claude-code-router` transformer plugin system
  - _Leverage: `claude-code-router` custom transformer pattern_
  - _Requirements: 1.1, 2.1_
  - _Prompt: Role: Node.js Developer | Task: Create `toon-transformer.js` file, export a class with `constructor(options)`, `name` property (returning "toon-encoder"), and empty `transformRequestIn(req)`, `transformResponseOut(res)` methods | Restrictions: Must follow `claude-code-router` custom transformer loading pattern | Success: Class file can be loaded by `claude-code-router` configuration without errors_

- [ ] 3. Implement JSON to TOON encoding logic
  - File: `~/.claude-code-router/plugins/toon-transformer.js` (continue from task 2)
  - Implement core logic in `transformRequestIn` method: import `toon`, iterate through `req.body.messages`, find `text` type `content` blocks, try `JSON.parse`, if successful call `toon.encode`, and replace text content
  - Purpose: Execute core functionality defined in requirements document (encode JSON)
  - _Leverage: `toon.encode`, `toon` README (for ````toon` format)_
  - _Requirements: 1.4, 1.5, 1.6, 1.7_
  - _Prompt: Role: Node.js Developer | Task: Implement logic in `transformRequestIn` to safely parse JSON strings in message content, convert using `toon.encode` (passing `options` from constructor), and replace original text with ````toon\n...\n```` block | Restrictions: Must follow `toon` recommended LLM input format | Success: Valid JSON in incoming request body is successfully converted to TOON format_

- [ ] 4. Implement robust error handling
  - File: `~/.claude-code-router/plugins/toon-transformer.js` (continue from task 3)
  - Add `try...catch` blocks in `transformRequestIn`
  - Purpose: Ensure invalid JSON or encoding failures don't cause entire request to fail (graceful degradation)
  - _Leverage: `try...catch` statements, `claude-code-router` logging system (if `req.log` available)_
  - _Requirements: NFR-Reliability_
  - _Prompt: Role: Node.js Developer | Task: Wrap JSON parsing and TOON encoding logic with `try...catch`. If error caught, should log warning and return original unmodified request body (or continue processing next block) | Restrictions: Must never let transformer errors cause request 500 failure; must gracefully degrade | Success: When invalid JSON or plain text is passed, request continues normally (unconverted) and warning is logged_

- [ ] 5. Register and apply transformer in `config.json`
  - File: `~/.claude-code-router/config.json`
  - Add `path` and `options` for `toon-transformer.js` in top-level `transformers` array
  - Add transformer `name` ("toon-encoder") to one or more `Providers`' `transformer.use` array
  - Purpose: Activate transformer in `claude-code-router`
  - _Leverage: `claude-code-router` `config.json` structure_
  - _Requirements: 1.1, 1.2, 2.1, 2.2_
  - _Prompt: Role: DevOps/Admin | Task: Modify `config.json` to register full path of `toon-transformer.js` in `transformers` array with optional `options`. Then add "toon-encoder" to target Provider's `transformer.use` array | Restrictions: Must be done in `config.json`; `path` must be correct | Success: After restarting `ccr`, transformer is active and processing requests_

- [ ] 6. Integration and testing
  - File: (no specific file)
  - Start `claude-code-router` (`ccr code`)
  - Send requests containing large JSON strings to models configured with transformer
  - Purpose: Verify entire flow (request -> routing -> transformation -> LLM API) works as expected
  - _Leverage: `claude-code-router` logs (`LOG_LEVEL: "debug"`), `ccr code`_
  - _Requirements: All_
  - _Prompt: Role: QA Engineer | Task: Start `claude-code-router` configured with TOON transformer and debug log level. Send three test requests: (1) with valid JSON, (2) with invalid JSON, (3) without JSON | Restrictions: Must check `claude-code-router` debug logs to confirm outbound API calls (`req.body`) match expectations | Success: (1) Logs show `req.body` contains ````toon...``, (2) Logs show `req.body` contains original invalid JSON, (3) Logs show `req.body` contains original text. All three requests complete successfully_

- [ ] 7. Create unit tests for transformer
  - File: `tests/transformers/toon-transformer.test.ts`
  - Write unit tests for `ToonTransformer` class methods
  - Mock `toon.encode` function for isolated testing
  - Purpose: Ensure transformer reliability and catch regressions
  - _Leverage: existing test framework and utilities_
  - _Requirements: 1, 2, NFR-Reliability_
  - _Prompt: Role: QA Engineer with expertise in unit testing and mocking frameworks | Task: Create comprehensive unit tests for ToonTransformer methods covering all requirements, using mocked dependencies and test utilities | Restrictions: Must test both success and failure scenarios, mock external dependencies, maintain test isolation | Success: All transformer methods are tested with good coverage, edge cases covered, tests run independently and consistently_

- [ ] 8. Performance testing and optimization
  - File: (performance test scripts)
  - Test transformer performance with various JSON payload sizes
  - Measure encoding latency and ensure it meets requirements (<50ms for 50KB payload)
  - Purpose: Validate performance requirements and identify optimization opportunities
  - _Leverage: performance testing tools_
  - _Requirements: NFR-Performance_
  - _Prompt: Role: Performance Engineer | Task: Create performance tests for TOON transformer with various JSON payload sizes to validate <50ms encoding time for 50KB payloads | Restrictions: Must test realistic data sizes, measure actual encoding time, identify bottlenecks | Success: Encoding performance meets requirements, transformer can handle expected load without significant latency_

- [ ] 9. Documentation and user guide
  - File: `docs/toon-transformer-guide.md`
  - Create comprehensive user documentation
  - Include installation, configuration, and usage examples
  - Purpose: Enable users to easily implement and use the TOON transformer
  - _Leverage: existing documentation templates_
  - _Requirements: NFR-Usability_
  - _Prompt: Role: Technical Writer | Task: Create comprehensive user guide for TOON transformer including installation steps, configuration examples, and troubleshooting | Restrictions: Must be clear and comprehensive, include practical examples, address common issues | Success: Documentation is complete and enables users to successfully implement transformer without additional support_

- [ ] 10. Final integration validation
  - File: (no specific file)
  - End-to-end testing with real Claude Code requests
  - Validate token reduction and response accuracy
  - Purpose: Ensure transformer works correctly in production scenarios
  - _Leverage: complete testing environment_
  - _Requirements: All_
  - _Prompt: Role: Integration Tester | Task: Perform comprehensive end-to-end validation of TOON transformer with real Claude Code workflows, verifying both token reduction and response accuracy | Restrictions: Must test realistic user scenarios, validate no functional degradation, measure actual token savings | Success: Transformer works correctly in production, achieves expected token reduction, maintains response quality_
