# Developer documentation and code presentation

Search the headings or contents below and read the relevant sections, including their exceptions and examples. All detailed article text is retained here.

## Contents
- [Code examples](#code-examples)
- [Developer content](#developer-content)
- [Formatting developer text elements](#formatting-developer-text-elements)
- [Reference documentation](#reference-documentation)

<a id="code-examples"></a>

## Code examples

```text
Code examples


Code examples illustrate how to use a programming element to implement specific
functionality. They might include:

      Simple, one-line examples interspersed with text.
      Short, self-contained examples that illustrate specific points.
      Long samples that illustrate multiple features, complex scenarios, or best practices.

Developers use code examples to:

      Assess a technology through its API during planning.
      Learn or explore a language or technology.
      Write and debug code.

Many developers copy example code from documentation into their own code or adapt
code examples to their own needs.

To create useful code examples, identify tasks and scenarios that are meaningful for your
audience, and then create examples that illustrate those scenarios. Code examples that
demonstrate product features are useful only when they address the problems that
developers are trying to solve.

Guidelines for planning code examples

      Create concise examples that exemplify key development tasks. Start with simple
      examples and build up complexity after you cover common scenarios.

      Prioritize frequently used elements and elements that may be difficult to
      understand or tricky to use.

      Don't use code examples to illustrate obvious points or contrived scenarios.

      Create code examples that are easy to scan and understand. Reserve complicated
      examples for tutorials and walkthroughs, where you can provide a step-by-step
      explanation of how the example works.

      Add an introduction to describe the scenario and explain anything that might not
      be clear from the code. List the requirements and dependencies for using or
      running the example.

      Provide an easy way for developers to copy and run the code. If the code example
      demonstrates interactive and animated features, consider providing a way for the

developer to run the example directly from your content page.

      Use appropriate keywords, linking strategies, and other search engine optimization
      (SEO) techniques to improve the visibility and usability of the code examples. For
      example, add links to relevant code example pages and content pages to improve
      SEO across your content. See Search and writing.

Guidelines for writing code examples

      Design code for reuse. Help developers determine what to modify. Add comments
      to explain details, but don't overdo it. Don't state the obvious.

      Show expected output, either in a separate section after the code example or by
      using code comments within the code example.

      Consider accessibility requirements for code that creates UI. For example, include
      alternate text for images.

      Write secure code. For example, always validate user input, never hard-code
      passwords in code, and use code-analysis tools to detect security issues.

      Show exception handling only when it's intrinsic to the example. Don't catch
      exceptions thrown when invalid arguments are passed to parameters.

      Always compile and test your code.
```

<a id="developer-content"></a>

## Developer content

```text
Developer content


Though the content for developers and IT professionals tends to be more technical than
that for a general audience, the fundamentals of the brand voice still apply. Be
warm and relaxed, crisp and clear, and ready to lend a hand as appropriate for the
context. After all, when they're not coding or managing solutions, developers and IT
pros are some of the very same people who play Xbox and use Office.

Of course, it's OK to assume IT pros and developers bring a fundamental understanding
of programming concepts. So skip the basic knowledge and focus on technology-
specific or product-specific information that helps them achieve their goals.

Two types of content form the foundation of developer documentation: reference
documentation and code examples. Reference documentation provides an encyclopedia
of all the programming elements, such as classes, methods, and properties, that are
available for writing applications. Code examples show how to use those elements.

This section provides guidelines for creating:

      Reference documentation
      Code examples

It also has guidelines for formatting developer text elements.
```

<a id="formatting-developer-text-elements"></a>

## Formatting developer text elements

```text
Formatting developer text elements


Consistent text formatting helps readers locate and interpret information. Follow these
formatting conventions for text elements that are commonly used in content for developers.

In general, use code style for programmatic or code-related elements. The following table lists
examples of common programming elements, and some exceptions to the code style convention.
Consider localization needs for the text elements that you're formatting.

The capitalization of developer text elements varies depending on the programming language or
operating environment. When you're documenting code, capitalization should follow what the
code uses.

See also
Capitalization
Formatting common text elements
Formatting text in instructions
Procedures and instructions


 Element                        Convention                     Example

 AI prompts                     Quotation marks, if you're     "List all of my subscriptions."
                                referencing prompts in
                                text.


                                If prompts appear in a list
                                and the introductory text
                                makes clear what those
                                items are, special
                                formatting isn't
                                necessary.

 Attributes                     Code style.                    IfOutputPrecision

 Classes (predefined or         Code style.                    ios
 user-defined)                                                 filebuf
                                                               BitArray
                                                               BlueTimerControl

 Code samples, including        Code style.                    #include <iostream.h>
 keywords and variables                                        void main ()

Element                           Convention                         Example

within text and as
separate paragraphs, and
user-defined program
elements within text

Command-line                      Code style.                        copy
commands

Command-line options              Code style. Capitalize the         /a
(also known as switches           way the option must be             /Aw
or flags)                         typed.

Constants                         Code style.                        INT_MAX
                                                                     bDenyWrite
                                                                     CS_DBLCLKS

Control classes                   Code style. All uppercase.         EDIT   control class

Data formats                      Code style. All uppercase.         CF_DIB    format

Data structures and their         Code style.                        BITMAP
members (predefined)                                                 bmBits
                                                                     CREATESTRUCT
                                                                     hInstance

Data types                        Code style. Capitalization         DWORD
                                  follows the API.                   float
                                                                     HANDLE

Database names                    Bold. Code style if using          Contoso database
                                  in code syntax.                    USE ContosoSalesDatabase;

Directives                        Code style.                        \#include
                                                                     \#define

Environment variables             Code style.                        INCLUDE
                                                                     SESSIONNAME

Error messages                    Sentence-style                     An error occurred during report processing.
                                  capitalization. Enclose in         If you see the error message "Placeholder text in a
                                  quotation marks when               content control contains items that aren't valid,"
                                  you're referencing error           remove floating objects, revision marks, or content
                                  messages in text.                  controls from placeholder text, and try again.

                                  If error messages appear
                                  in a list and the
                                  introductory text makes
                                  clear what those items

Element                           Convention                         Example

                                  are, special formatting
                                  isn't necessary.

Event names                       Code style.                        In the  OnClick    event procedure ....

Fields (members of a              Code style.                         IfHeight
class or structure)                                                   biPlanes

File attributes                   All lowercase.                     The   attrib   command displays, sets, or removes
                                                                     the read-only, archive, system, and hidden
                                                                     attributes assigned to files or directories.

File name extensions              All lowercase.                     .mdb
                                                                     .doc

File names (user-defined          Apply code style if used            MyTaxesFor2025
examples)                         in code. Use bold or plain         My Taxes for 2025
                                  text if referencing UI.

Folder and directory              Apply code style if used            MyFiles\Accounting\Payroll\VacPay
names (user-defined               in code. Use bold or plain         Vacation and sick pay
examples)                         text if referencing UI.

Functions (predefined)            Code style.                         CompactDatabase
                                                                      CWnd::CreateEx
                                                                      FadePic

Handles                           Code style. All uppercase.          HWND

Keywords (language and            Code style. Capitalization          main
operating system)                 follows the API.                    True
                                                                      void

Logical operators                 Code style.                         AND
                                                                      XOR

Macros                            Code style.                         LOWORD
                                                                      MASKROP

Markup language                   Code style.                         <img>
elements (tags)                                                       <input type="text">
                                                                      <!DOCTYPE html>

Mathematical constants            Italic.                            a² + b² = c²
and variables

Members                           Code style.                         ulNumCharsAllowed

Methods                           Code style.                         OpenForm()

Element                            Convention                         Example

                                                                      GetPrevious()

New terms                          Italicize the first mention        Microsoft Exchange consists of both server and
                                   of a new term if you're            client components.
                                   going to define it
                                   immediately in text.

Operators                          Bold. Use code style for           +, -
                                   code-related operators.            sizeof

Parameters                         Code style.                        Hdc
                                                                      grfFlagClientBinding

Placeholders (in syntax            Italic when placeholder            Enter password.
and in user input)                 element is UI text. Use            /v: <version>
                                   angle brackets for code
                                   placeholders when angle
                                   brackets aren't part of the
                                   language syntax.

Ports                              All uppercase.                     LPT1

Products, services, apps,          Usually title-style                Microsoft Arc Touch Mouse
and trademarks                     capitalization. Check the          Microsoft Word
                                   Microsoft trademark                Surface Pro
                                   list   for capitalization of       Notepad
                                   trademarked names.                 Network Connections
                                                                      Makefile
                                                                      RC program

Properties                         Code style.                        M_bClipped
                                                                      AbsolutePosition
                                                                      Message ID

Registers                          Code style.                        DS

Registry settings                  Subtrees (first-level items)       HKEY_CLASSES_ROOT
                                   all uppercase. Separated           HKEY_LOCAL_MACHINE
                                   by underscores. Usually            SOFTWARE
                                   code style.                        ApplicationIdentifier
                                   Registry keys (second-
                                   level items) follow the
                                   capitalization of the UI.
                                   Registry subkeys (below
                                   the second level) follow
                                   the capitalization of the
                                   Regedit UI.

Element                            Convention                         Example

Statements                         Code style.                        IMPORTS
                                                                      LIBRARY

Structures                         Code style.                        ACCESSTIMEOUT

Switches                           Code style. Usually                build: commands
                                   lowercase.

UI text or strings                 Treatment varies; see              Import from file
                                   Formatting text in                 Create a new resource
                                   instructions. Sentence-            See all your resources
                                   style capitalization.              Manually trigger a flow
                                                                      Report a bug

URLs                               All lowercase for                  www.microsoft.com
                                   complete URLs. If                  www.microsoft.com/download
                                   necessary, line-break long         const url = "https://www.microsoft.com"
                                   URLs before a slash. Don't
                                   hyphenate. Use code
                                   style if referring to URLs
                                   in code.
                                   See also URLs and web
                                   addresses.

User input                         Usually lowercase, unless          Enter hello world
                                   case sensitive. Bold. Use          Enter password
                                   italic only for
                                   placeholders.

Values                             Code style. All uppercase.         DIB_PAL_COLORS

Variables                          Usually code style.                bEmpty
                                                                      m_nParams
                                                                      file_name

XML schema elements                Code style. Usually                <configuration>
                                   surrounded with angle              ElementType     element
                                   brackets.


Last updated on 04/28/2026
```

<a id="reference-documentation"></a>

## Reference documentation

```text
Reference documentation


Reference documentation provides details about the programming elements associated
with technologies and languages, including class libraries, object models, and
programming language constructs.

Consistency is essential in reference documentation. A standard article design,
predictable headings and structure, and consistent wording help developers find what
they need quickly. Links to articles with related information are also a common feature.

Note Information such as configuration schemas, compiler options, and error messages
might not follow the guidelines described in this section.

Article titles

Use the name of a programming element (such as Clear), followed by an element type
(such as Class, Method, Property, or Event). If the name is shared by multiple elements,
add a differentiator, such as the parent element name or the product or technology
name. Differentiators are particularly important in search results, where they help
customers find the article for the correct product or element.

Examples
Clear method
Device.Clear method
Clear method (ADO)

Elements of a reference article

The table lists the information typically provided in reference articles. Not all sections
appear in all reference articles. Sections vary depending on the language, product, or
technology being documented.


 Section                  Contains

 Title and                The name of the element and a concise sentence or two describing the
 description              element. If possible, explain what the element does or represents without
                          repeating the element name.
                          Example

Section                     Contains

                            MoveRecord method (ADO)
                            Moves the entity represented by a Record to another location.

Declaration/syntax          The code signature that defines the element. This section might also
                            provide usage syntax. If the technology can be used with multiple
                            programming languages, provide syntax for each language.
                            Example
                             Record.MoveRecord (Source, Destination, UserName, Password, Options,
                            Async)

Parameters                  If the element has parameters, provide a description of each parameter
                            and its data type. If appropriate, indicate whether the parameter is
                            required or optional and whether it represents input or output. Provide as
                            much useful detail as possible. Don't just repeat the words in the
                            parameter name or the data type.
                            Examples
                            Source
                            Optional. A String value that contains a URL identifying the Record to be
                            moved. If Source is omitted or specifies an empty string, the object
                            represented by this Record is moved. For example, if the Record
                            represents a file, the contents of the file are moved to the location
                            specified by Destination.


                            Destination
                            Optional. A String value that contains a URL specifying the location where
                            Source will be moved.

                            UserName
                            Optional. A String value that contains the user ID that, if needed,
                            authorizes access to Destination.


                            Password
                            Optional. A String that contains the password that, if needed, verifies
                            UserName.

                            Options
                            Optional. A MoveRecordOptionsEnum value whose default value is
                            adMoveUnspecified. Specifies the behavior of this method.


                            Async
                            Optional. A Boolean value that, when True, specifies this operation should
                            be asynchronous.

Return value                If the element returns a value, describe the value and information about its
                            data type. If the value is a Boolean that indicates the presence of a
                            condition, describe the condition.
                            Example

Section                     Contains

                            A String value. Typically, the value of Destination is returned. However, the
                            exact value returned is provider-dependent.

Remarks                     Additional information about the element and important details that may
                            not be obvious from its syntax, parameters, or return value. For example,
                            you might explain what the element does in more detail, compare it with
                            similar elements, and identify potential issues in its use.
                            Example
                            The values of Source and Destination must not be identical; otherwise, a
                            runtime error occurs. At least the server, path, and resource names must
                            differ.

                            For files moved using the Internet Publishing Provider, this method
                            updates all hypertext links in files being moved unless otherwise specified
                            by Options. This method fails if Destination identifies an existing object (for
                            example, a file or directory), unless adMoveOverWrite is specified.

                            Note Use the adMoveOverWrite option judiciously. For example,
                            specifying this option when moving a file to a directory will delete the
                            directory and replace it with the file.


                            Certain attributes of the Record object, such as the ParentURL property,
                            won't be updated after this operation completes. Refresh the Record
                            object's properties by closing the Record, then reopening it with the URL
                            of the location where the file or directory was moved.

                            If this Record was obtained from a Recordset, the new location of the
                            moved file or directory won't be reflected immediately in the Recordset.
                            Refresh the Recordset by closing and reopening it.

                            Note URLs using the http scheme will automatically invoke the Microsoft
                            OLE DB Provider for Internet Publishing. For more information, see
                            Absolute and Relative URLs.

Example                     A code example that illustrates how to use the programming element. For
                            more information about writing useful code examples, see Code examples.

Requirements or             Language or platform requirements for using the element.
Applies to                  Example
                            Record Object (ADO)

See also                    References or links to more information about how to use the element.
                            References or links to related elements.
                            Examples
                            Move Method (ADO)
                            MoveFirst, MoveLast, MoveNext, and MovePrevious Methods (ADO)
                            MoveFirst, MoveLast, MoveNext, and MovePrevious Methods (RDS)

Other information can appear in reference articles as appropriate to the language,
product, or technology. For example, instead of a parameter description as shown in the
preceding table, there can be descriptions of members, methods, property values, and
field values. The following table contains an example of a property value and examples
of exceptions and permissions.


 Section                  Contains

 Property value           A description of the value for a property or field. If the property or field has a
                          default value, describe that, too. Include the data type of the property value
                          if applicable.
                          Example
                          Property Value
                          String
                          Returns or sets a String value representing the current date according to
                          your system.

 Exceptions/error         If the element can throw exceptions or raise errors when called, list them
 codes                    and describe the conditions under which they occur.
                          Example
                          IOException—An I/O error occurred.
                          ArgumentNullException—format is null.
                          FormatException—The format specification in format is invalid.

 Permissions              Security permissions that apply to the element, if required.
                          Example
                          Requires CREATE FUNCTION permission in the database and ALTER
                          permission on the schema in which the function is being created. If the
                          function specifies a user-defined type, requires EXECUTE permission on the
                          type.


If you automatically generate reference documentation and comments from the source
code, review the quality and appropriateness of the comments. Developers might leave
out details that are important to customers. Remove any implementation or internal
details that aren't suitable for documentation.

Learn more For other examples of technical reference articles, see the .NET API Browser.
```
