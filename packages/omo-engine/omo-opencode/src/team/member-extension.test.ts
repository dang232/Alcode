import { describe, expect, test } from "bun:test"

import {
  MEMBER_IDENTITY_ENV,
  MEMBER_TASK_ID_ENV,
  MEMBER_TEAM_CONFIG_ENV,
  MemberExtensionConfigError,
  formatMemberIdentity,
  isTeamMemberProcess,
  parseMemberExtensionEnv,
} from "./member-extension"

describe("member extension identity", () => {
  test("#given no identity env #when checked #then it is not a member process", () => {
    // when / then
    expect(isTeamMemberProcess({})).toBe(false)
    expect(parseMemberExtensionEnv({})).toBeUndefined()
  })

  test("#given a well-formed member env #when parsed #then the identity round-trips", () => {
    // given
    const teamRunId = "11111111-1111-1111-1111-111111111111"
    const env = {
      [MEMBER_IDENTITY_ENV]: formatMemberIdentity(teamRunId, "alpha"),
      [MEMBER_TASK_ID_ENV]: "task-1",
      [MEMBER_TEAM_CONFIG_ENV]: '{"members":["alpha"]}',
    }

    // when
    expect(isTeamMemberProcess(env)).toBe(true)
    expect(parseMemberExtensionEnv(env)).toEqual({
      teamRunId,
      memberName: "alpha",
      taskId: "task-1",
      teamConfig: '{"members":["alpha"]}',
    })
  })

  test("#given a malformed identity #when parsed #then a typed error is thrown", () => {
    // given
    const env = {
      [MEMBER_IDENTITY_ENV]: "not-an-identity",
      [MEMBER_TASK_ID_ENV]: "task-1",
      [MEMBER_TEAM_CONFIG_ENV]: "{}",
    }

    // when
    const parse = (): unknown => parseMemberExtensionEnv(env)

    // then
    expect(parse).toThrow(MemberExtensionConfigError)
    try {
      parse()
    } catch (error) {
      expect((error as MemberExtensionConfigError).code).toBe("malformed_identity")
    }
  })

  test("#given an identity without a task id #when parsed #then a missing-config error is thrown", () => {
    // given
    const env = {
      [MEMBER_IDENTITY_ENV]: formatMemberIdentity("11111111-1111-1111-1111-111111111111", "alpha"),
      [MEMBER_TEAM_CONFIG_ENV]: "{}",
    }

    // when / then
    expect(() => parseMemberExtensionEnv(env)).toThrow(
      expect.objectContaining({ name: "MemberExtensionConfigError", code: "missing_config" }),
    )
  })
})
