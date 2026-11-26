// Registers the test loader (JSON imports, three.js mocks). Use: node --import ./tests/helpers/register.mjs --test "tests/**/*.test.mjs"
import { register } from 'node:module';
register('./full_loader.mjs', import.meta.url);
