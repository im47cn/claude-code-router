declare module "minimist" {
  interface Opts {
    string?: string[];
    boolean?: string[];
    alias?: Record<string, string | string[]>;
    default?: Record<string, any>;
    unknown?: (arg: string) => boolean;
    "--"?: boolean;
    stopEarly?: boolean;
    parse?: (arg: string) => any;
  }

  interface Result {
    _: string[];
    [key: string]: any;
  }

  function minimist(argv: string[], opts?: Opts): Result;
  export = minimist;
}
