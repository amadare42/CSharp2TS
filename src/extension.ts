'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as types from './types';
/**Generate a typescript property */
function generateTypescriptProperty(csType: string, name: string, config: ExtensionConfig): string {
    //trim spaces:
    var tsType = types.parseType(csType).convertToTypescript();
    name = getTypescriptPropertyName(name, config);
    tsType = trimMemberName(tsType, config);

    return name + ": " + tsType + ";";
}

function getTypescriptPropertyName(name: string, config: ExtensionConfig) {
    var isAbbreviation = name.toUpperCase() == name;
    name = trimMemberName(name, config);
    if (config.propertiesToCamelCase && !isAbbreviation) {
        return name[0].toLowerCase() + name.substr(1);
    }

    return name;
}

/**Convert a c# automatic or fat arrow property to a typescript property. Returns null if the string didn't match */
function csAutoProperty(code: string, config: ExtensionConfig): Match {

    //identifier regex = ([a-zA-Z0-9_]+)
    //typeRegex = ((?:[a-zA-Z0-9_]+)\s*(?:<.*>)?\s*\??(?:\[,*\])*)
    //test case = Tuple<List<int[], Tuple<bool, int[]>>[][], bool[]>[]
    //test case = int
    //test clase = List<bool>
    //get set = (?:{\s*(?:(?:(?:internal)|(?:public)|(?:private)|(?:protected)))?\s*get\s*;\s*(?:(?:(?:(?:internal)|(?:public)|(?:private)|(?:protected)))?\s*set;\s*)?})
    //fat arrow = (?:=>.*;)
    //get set or fat arrow = (?:(?:{\s*(?:(?:(?:internal)|(?:public)|(?:private)|(?:protected)))?\s*get\s*;\s*(?:(?:(?:(?:internal)|(?:public)|(?:private)|(?:protected)))?\s*set;\s*)?})|(?:=>.*;))
    var patt =
        /(?:public\s+)?(?:(?:(?:new)|(?:override))\s+)?((?:[a-zA-Z0-9_]+)\s*(?:<.*>)?\s*\??(?:\[,*\])*)\s+([a-zA-Z0-9_]+)\s*(?:(?:{\s*(?:(?:(?:internal)|(?:public)|(?:private)|(?:protected)))?\s*get\s*;\s*(?:(?:(?:(?:internal)|(?:public)|(?:private)|(?:protected)))?\s*set;\s*)?})|(?:=>.*;))/;

    var arr = patt.exec(code);
    if (!arr) {
        return null;
    }
    var type = arr[1];
    var name = arr[2];
    return {
        result: generateTypescriptProperty(type, name, config),
        index: arr.index,
        length: arr[0].length
    };

}

function csAttribute(code: string, config: ExtensionConfig): Match {
    var patt = /[ \t]*\[\S*\][ \t]*\r?\n/;
    var arr = patt.exec(code);
    if (arr == null) return null;

    return {
        result: "",
        index: arr.index,
        length: arr[0].length
    };
}

interface Match {
    /**Replacement string */
    result: string;
    /**Original index */
    index: number;
    /**Original lenght */
    length: number;
}

function csCommentSummary(code: string, config: ExtensionConfig): Match {
    var patt = /\/\/\/ <summary>\r?\n((?:\s*\/\/\/.*\r?\n?)*) <\/summary>/;
    var arr = patt.exec(code);
    if (arr == null) return null;

    //Split summary lines:
    var lines = arr[1];
    var separatorPattern = /([ \t]*)\/\/\/\s?(.+)/g;
    var lineArr: RegExpExecArray;
    var ret = "/*";
    var first = true;
    while ((lineArr = separatorPattern.exec(arr[1])) != null) {
        if (!first) {
            ret += "\r\n" + lineArr[1];
        }

        ret += "*" + lineArr[2];

        first = false;
    }
    ret += " */";
    return {
        result: ret,
        index: arr.index,
        length: arr[0].length
    };
}

function csPublicMember(code: string, config: ExtensionConfig): Match {
    var patt = /public\s*(?:(?:abstract)|(?:sealed))?(\S*)\s+(.*)\s*{/;
    var arr = patt.exec(code);

    var tsMembers: { [index: string]: string } = {
        'class': 'interface',
        'struct': 'interface'
    };

    if (arr == null) return null;
    var tsMember = tsMembers[arr[1]];
    var name = trimMemberName(arr[2], config);
    return {
        result: `export ${tsMember || arr[1]} ${name} {`,
        index: arr.index,
        length: arr[0].length
    };
}

function trimMemberName(name: string, config: ExtensionConfig): string {    
    name = name.trim();

    var postfixes = config.trimPostfixes;
    if (!postfixes)
        return name;        
    var trimRecursive = config.recursiveTrimPostfixes;

    var trimmed = true;
    do {
        trimmed = false;

        for (let postfix of postfixes) {
            if (!name.endsWith(postfix))
                continue;

            name = trimEnd(name, postfix);
            if (!trimRecursive)
                return name;

            trimmed = true;
        }
    } while (trimmed); // trim recursive until no more occurrences will be found

    return name;
}

function trimEnd(text: string, postfix: string) {
    if (text.endsWith(postfix)) {
        return text.substr(0, text.length - postfix.length);
    }
    return text;
}

/**Find the next match */
function findMatch(code: string, startIndex: number, config: ExtensionConfig): Match {
    code = code.substr(startIndex);

    var functions: ((code: string, config: ExtensionConfig) => Match)[] = [
        csAutoProperty,
        csCommentSummary,
        csAttribute,
        csPublicMember
    ];

    var firstMatch: Match = null;
    for (let i = 0; i < functions.length; i++) {
        var match = functions[i](code, config);
        if (match != null && (firstMatch == null || match.index < firstMatch.index)) {
            firstMatch = match;
        }
    }

    return firstMatch ? {
        result: firstMatch.result,
        index: firstMatch.index + startIndex,
        length: firstMatch.length
    } : null;
}

/**Convert c# code to typescript code */
export function cs2ts(code: string, config: ExtensionConfig): string {
    var ret = "";
    var lineArr: RegExpExecArray;
    var lastAddedLineJump = true;

    var index = 0;
    while (true) {
        var nextMatch = findMatch(code, index, config);
        if (nextMatch == null)
            break;
        //add the last unmatched code:
        ret += code.substr(index, nextMatch.index - index);

        //add the matched code:
        ret += nextMatch.result;

        //increment the search index:
        index = nextMatch.index + nextMatch.length;
    }
    //add the last unmatched code:
    ret += code.substr(index);

    return ret;
}



// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Congratulations, your extension "csharp2ts" is now active!');

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with  registerCommand
    // The commandId parameter must match the command field in package.json
    let disposable = vscode.commands.registerCommand('extension.cs2ts', () => {
        // The code you place here will be executed every time your command is executed

        var editor = vscode.window.activeTextEditor;
        if (!editor)
            return;

        var selection = editor.selection;
        var text = editor.document.getText(selection);

        editor.edit(e => {
            var config = getConfiguration();
            e.replace(selection, cs2ts(text, config));
        });
    });

    context.subscriptions.push(disposable);
}

function getConfiguration(): ExtensionConfig {

    var rawTrimPostfixes = vscode.workspace.getConfiguration('csharp2ts').get("trimPostfixes") as string|string[];
    var trimPostfixes:string[] = [];
    if (typeof rawTrimPostfixes == "string"){
        trimPostfixes = [rawTrimPostfixes];
    } else {
        trimPostfixes = rawTrimPostfixes;
    }

    var propertiesToCamelCase = vscode.workspace.getConfiguration('csharp2ts').get("propertiesToCamelCase") as boolean;
    var recursiveTrimPostfixes =  vscode.workspace.getConfiguration('csharp2ts').get("recursiveTrimPostfixes") as boolean

    return {
        propertiesToCamelCase,
        trimPostfixes,
        recursiveTrimPostfixes,
    };
}


// this method is called when your extension is deactivated
export function deactivate() {
}

export interface ExtensionConfig {
    propertiesToCamelCase: boolean;
    trimPostfixes: string[];
    recursiveTrimPostfixes: boolean;
}