import { Controller, Post, Body, HttpCode, Inject } from "@danet/core";
import type { AuthRequestDto, AuthResponseDto, VerifyAuthCodeDto } from "@dto/auth.ts";
import { sendAuthCode, UnauthorizedEmailError, WebhookError } from "@domain/coordinators/auth-send-code/mod.ts";
import { verifyAuthCode, InvalidAuthCodeError } from "@domain/coordinators/auth-verify-code/mod.ts";
import { blacklistAuthCode, InvalidCodeError } from "@domain/coordinators/auth-blacklist-code/mod.ts";
import type { RedisCodeBlacklistAdapter } from "@domain/data/redis-code-blacklist/mod.ts";
import { unauthorized, internalError, badRequest } from "./http-error.ts";

@Controller("auth")
export class AuthController {
  constructor(
    @Inject("RedisCodeBlacklist") private readonly blacklist: RedisCodeBlacklistAdapter,
  ) {}

  @Post("/")
  @HttpCode(200)
  async requestAuthCode(@Body() request: AuthRequestDto): Promise<AuthResponseDto> {
    try {
      await sendAuthCode(request.email);
      return { message: "Auth code sent successfully" };
    } catch (error: unknown) {
      if (error instanceof UnauthorizedEmailError) unauthorized(error.message);
      if (error instanceof WebhookError) internalError(error.message);
      internalError("Failed to send auth code");
    }
  }

  @Post("/verify")
  @HttpCode(200)
  async verifyCode(@Body() request: VerifyAuthCodeDto): Promise<AuthResponseDto> {
    try {
      await verifyAuthCode(this.blacklist, request.email, request.code);
      return { message: "Auth code verified successfully" };
    } catch (error: unknown) {
      if (error instanceof InvalidAuthCodeError) unauthorized(error.message);
      internalError("Failed to verify auth code");
    }
  }

  @Post("/blacklist")
  @HttpCode(200)
  async blacklistCode(@Body() request: VerifyAuthCodeDto): Promise<AuthResponseDto> {
    try {
      await blacklistAuthCode(this.blacklist, request.email, request.code);
      return { message: "Auth code blacklisted successfully" };
    } catch (error: unknown) {
      if (error instanceof InvalidCodeError) badRequest(error.message);
      internalError("Failed to blacklist auth code");
    }
  }
}
