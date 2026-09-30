import type {AgentHost} from './api';
export type ExecutionHostChoice={id:string;name:string;kind:'central'|'desktop';online:boolean;isLocal:boolean;missing:boolean;disambiguator:string;platformLabel:string;note:string;group:string;search:string};
export function executionHostChoices(hosts?:AgentHost[],value?:string,localHostId?:string):ExecutionHostChoice[];
export function groupExecutionHosts(choices:ExecutionHostChoice[],query?:string):{id:string;label:string;choices:ExecutionHostChoice[]}[];
export function canSelectExecutionHost(choice?:ExecutionHostChoice,disabled?:boolean):boolean;
