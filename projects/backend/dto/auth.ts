import { IsEmail, IsNotEmpty, IsString, Length } from "class-validator";

export class AuthRequestDto {
  @IsEmail({}, { message: "Invalid email format" })
  @IsNotEmpty({ message: "Email is required" })
  email!: string;
}

export class AuthResponseDto {
  message!: string;
}

export class VerifyAuthCodeDto {
  @IsEmail({}, { message: "Invalid email format" })
  @IsNotEmpty({ message: "Email is required" })
  email!: string;

  @IsString({ message: "Code must be a string" })
  @IsNotEmpty({ message: "Code is required" })
  @Length(10, 10, { message: "Code must be exactly 10 characters" })
  code!: string;
}
