export type Permission = "auth" | "queue";
export type UserStatus = "active" | "inactive";

export type User = {
  username: string;
  passwordHash: string;
  permissions: Permission[];
  status: UserStatus;
};

export type PublicUser = Omit<User, "passwordHash">;

export type CreateUserRequest = {
  username: string;
  password: string;
  permissions: Permission[];
};

export type UpdateUserRequest = {
  password?: string;
  permissions?: Permission[];
  status?: UserStatus;
};
