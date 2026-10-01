import type { AgentHost, AgentState } from './api';
export function projectDirectoryValue(value:unknown):string;
export function readProjectDirectory(storage:Pick<Storage,'getItem'>|undefined,scope:string,hostId:string):string;
export function saveProjectDirectory(storage:Pick<Storage,'getItem'|'setItem'>|undefined,scope:string,hostId:string,directory:string):void;
export function projectDirectoryIssue(directory:string,host?:AgentHost):string;
export function executionProjectDirectory(agent?:AgentState,pending?:{payload:{projectDirectory?:string}}|null):string|undefined;
