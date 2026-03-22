export interface NgrokYamlParams {
  authtoken: string;
  tcpUrl: string;
  httpDomain: string;
  httpAuth?: string[];
}

export class NgrokConfigBuilder {
  buildYaml(params: NgrokYamlParams): string {
    const lines = [
      `version: "3"`,
      `agent:`,
      `  authtoken: ${params.authtoken}`,
      `tunnels:`,
      `  ssh:`,
      `    proto: tcp`,
      `    addr: 22`,
      `    url: ${params.tcpUrl}`,
      `  http:`,
      `    proto: http`,
      `    addr: 80`,
      `    domain: ${params.httpDomain}`,
    ];

    if (params.httpAuth && params.httpAuth.length > 0) {
      lines.push(`    basic_auth:`);
      for (const entry of params.httpAuth) {
        lines.push(`      - "${entry}"`);
      }
    }

    return lines.join("\n");
  }
}
