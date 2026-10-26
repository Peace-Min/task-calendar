using System.Collections.Generic;
using System.Text.Json;

namespace TaskCalendarWidget
{
    // Executed both in WebView2 and against fixture company pages in QA.
    internal static class AttendanceCompanyScripts
    {
        internal const string Read = @"(function(){
          var names=['sdate','edate','subject','content','endwork','planwork','notendwork','problem','resultwork','status','overtime','iscompletion'];
          if(document.querySelector('input[type=password]'))throw Error('로그인이 필요합니다.');
          var o={}; names.forEach(function(n){var a=document.getElementsByName(n);if(a.length>1)throw Error('중복 필드: '+n);if(a.length===1)o[n]=String(a[0].value||'');});
          if(!Object.prototype.hasOwnProperty.call(o,'content'))throw Error('회사 보고 입력 필드가 없습니다.');
          return JSON.stringify(o);
        })()";

        internal static string Post(string action, Dictionary<string, string> replace) =>
          @"(function(){
            var patch=" + JsonSerializer.Serialize(replace) + @", action=" + JsonSerializer.Serialize(action) + @";
            if(document.querySelector('form[data-tc-attendance]'))throw Error('이미 전송을 요청했습니다.');
            var all=document.querySelectorAll('input[name],textarea[name],select[name]'), values=[];
            for(var i=0;i<all.length;i++){
              var e=all[i], t=String(e.type||'').toLowerCase();
              if(e.disabled||/^(file|button|submit|reset|image)$/.test(t)||((t==='checkbox'||t==='radio')&&!e.checked))continue;
              if(e.tagName==='SELECT'&&e.multiple){for(var j=0;j<e.options.length;j++)if(e.options[j].selected)values.push([e.name,e.options[j].value]);}
              else values.push([e.name,String(e.value||'')]);
            }
            var f=document.createElement('form');f.setAttribute('data-tc-attendance','1');f.method='post';f.enctype='multipart/form-data';f.acceptCharset='euc-kr';f.action=action;
            function put(n,v){var e=document.createElement('textarea');e.name=n;e.value=v;f.appendChild(e);}
            values.forEach(function(x){if(!Object.prototype.hasOwnProperty.call(patch,x[0]))put(x[0],x[1]);});
            Object.keys(patch).forEach(function(k){put(k,patch[k]);});
            document.body.appendChild(f);HTMLFormElement.prototype.submit.call(f);return 'DISPATCHED';
          })()";
    }
}
