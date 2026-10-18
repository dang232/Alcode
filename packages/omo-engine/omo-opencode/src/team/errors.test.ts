import { describe, expect, test } from "bun:test"

import { TeamSpecError } from "./errors"
import { MemberRespawnError, MemberRevivalError, TeamRuntimeError } from "./runtime-types"

describe("team error vocabulary", () => {
  test("#given a spec failure #when raised #then the code and team travel with it", () => {
    // when
    const error = new TeamSpecError("bad spec", "UNRESOLVABLE_CATEGORY", "squad")

    // then
    expect(error.name).toBe("TeamSpecError")
    expect(error.code).toBe("UNRESOLVABLE_CATEGORY")
    expect(error.teamName).toBe("squad")
  })

  test("#given a runtime failure #when raised #then the code and team ref travel with it", () => {
    // when
    const error = new TeamRuntimeError("too big", "bounds_exceeded", "squad")

    // then
    expect(error.name).toBe("TeamRuntimeError")
    expect(error.code).toBe("bounds_exceeded")
    expect(error.teamRef).toBe("squad")
  })

  test("#given recovery failures #when raised #then the member identity is recorded", () => {
    // when
    const respawn = new MemberRespawnError("task_mapping_mismatch", "run-1", "alpha")
    const revival = new MemberRevivalError("session_unavailable", "run-1", "alpha")

    // then
    expect(respawn.name).toBe("MemberRespawnError")
    expect(respawn.code).toBe("task_mapping_mismatch")
    expect(respawn.teamRunId).toBe("run-1")
    expect(respawn.memberName).toBe("alpha")
    expect(revival.name).toBe("MemberRevivalError")
    expect(revival.code).toBe("session_unavailable")
  })
})
