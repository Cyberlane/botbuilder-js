/**
 * @module botbuilder-m365
 */
/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { TurnContext } from 'botbuilder-core';
import { TurnState } from './TurnState';
import { readFile } from 'fs/promises';
import { ConversationHistoryOptions, ConversationHistoryTracker } from './ConversationHistoryTracker';

enum PromptParseState { inText, inVariable }

export type PromptTemplate = string|((context: TurnContext, state: TurnState) => Promise<string>);

export interface PromptParseOptions {
    conversationHistory?: Partial<ConversationHistoryOptions>;
}

export class PromptParser {
    public static async expandPromptTemplate(context: TurnContext, state: TurnState, prompt: PromptTemplate, options?: PromptParseOptions): Promise<string> {
        // Get template
        let promptTemplate: string;
        if (typeof prompt == 'function') {
            promptTemplate = await prompt(context, state);
        } else {
            promptTemplate = await readFile(prompt, { encoding: 'utf8' });
        }

        // Expand template
        let variableName: string;
        let parseState = PromptParseState.inText;
        let outputPrompt = '';
        for (let i = 0; i < promptTemplate.length; i++) {
            const ch = promptTemplate[i];
            switch (parseState) {
                case PromptParseState.inText:
                default:
                    if (ch == '{' && (i+1) < promptTemplate.length && promptTemplate[i+1] == '{') {
                        // Skip next character and change parse state
                        i++;
                        variableName = '';
                        parseState = PromptParseState.inVariable;
                    } else {
                        // Append character to output
                        outputPrompt += ch;
                    }
                    break;
                case PromptParseState.inVariable:
                    if (ch == '}') {
                        // Skip next character and change state
                        if ((i+1) < promptTemplate.length && promptTemplate[i+1] == '}') {
                            i++;
                            parseState = PromptParseState.inText;
                        }

                        // Append variable contents to output
                        outputPrompt += PromptParser.lookupPromptVariable(context, state, variableName);
                    } else {
                        // Append character to variable name
                        variableName += ch;
                    }
                    break;
            }
        }

        return outputPrompt;
    }
 

    public static lookupPromptVariable(context: TurnContext, state: TurnState, variableName: string, options?: PromptParseOptions): string {
        // Split variable name into parts and validate
        // TODO: Add support for longer dotted path variable names
        const parts = variableName.trim().split('.');
        if (parts.length != 2) {
            throw new Error(`OpenAIPredictionEngine: invalid variable name of "${variableName}" specified`);
        }

        // Check for special cased variables first
        switch (parts[0]) {
            case 'activity':
                // Return activity field
                return (context.activity as any)[parts[1]] ?? '';
            default:
                // Find referenced state entry
                const entry = state[parts[0]];
                if (!entry) {
                    throw new Error(`OpenAIPredictionEngine: invalid variable name of "${variableName}" specified. Couldn't find a state named "${parts[0]}".`);
                }

                // Special case `conversation.history` reference
                if (parts[0] == 'conversation' && parts[1] == 'history') {
                    return ConversationHistoryTracker.getHistoryAsText(context, state, options?.conversationHistory);
                }

                // Return state field
                return entry.value[parts[1]];
        }
    }
}