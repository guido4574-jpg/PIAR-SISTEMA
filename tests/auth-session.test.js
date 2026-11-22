const test = require("node:test");
const assert = require("node:assert/strict");
const { currentUser, SESSION_COOKIE } = require("../backend/auth");

test("malformed session cookie is treated as an absent session", async () => {
    const db = {
        promise() {
            return {
                query() {
                    assert.fail("invalid cookie must not reach the database");
                }
            };
        }
    };

    const user = await currentUser(db, {
        headers: { cookie: `${SESSION_COOKIE}=%E0%A4%A` }
    });

    assert.equal(user, null);
});
