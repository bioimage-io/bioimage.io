<template>
  <div class="markdown-body">
    <b-loading
      :is-full-page="false"
      :active.sync="loading"
      :can-cancel="false"
    ></b-loading>
    <div v-if="docs" v-html="docs"></div>
  </div>
</template>

<script>
import "../../node_modules/github-markdown-css/github-markdown.css";
import "../../node_modules/highlight.js/styles/github.css";
import marked from "marked";
import DOMPurify from "dompurify";
import hljs from "highlight.js";
import { initializeRunButtons } from "../imjoy-run-buttons";

import { replaceAllRelByAbs } from "../utils";

const dompurifyConfig = { ADD_TAGS: ["#comment"], FORCE_BODY: true };

export default {
  name: "Markdown",
  props: {
    baseUrl: {
      type: String,
      default: ""
    },
    content: {
      type: String,
      default: null
    },
    url: {
      type: String,
      default: null
    },
    enableRunButtons: {
      type: Boolean,
      default: false
    },
    runButtonContext: {
      type: Object,
      default: null
    }
  },
  data() {
    return {
      docs: null,
      loading: false
    };
  },
  created() {
    //open link in a new tab
    const renderer = new marked.Renderer();
    renderer.link = function(href, title, text) {
      var link = marked.Renderer.prototype.link.call(this, href, title, text);
      return link.replace("<a", "<a target='_blank' ");
    };
    renderer.image = function(href, title, text) {
      var link = marked.Renderer.prototype.image.call(this, href, title, text);
      return link.replace("/./", "/");
    };
    marked.setOptions({
      renderer: renderer,
      highlight: function(code) {
        return hljs.highlightAuto(code).value;
      }
    });
    DOMPurify.addHook("afterSanitizeAttributes", function(node) {
      // set all elements owning target to target=_blank
      if ("target" in node) {
        node.setAttribute("target", "_blank");
        // prevent https://www.owasp.org/index.php/Reverse_Tabnabbing
        node.setAttribute("rel", "noopener noreferrer");
      }
    });
  },
  watch: {
    content: function(newContent) {
      this.docs = DOMPurify.sanitize(
        replaceAllRelByAbs(marked(newContent), this.baseUrl),
        dompurifyConfig
      );
      this.loading = false;
    },
    docs: function() {
      if (this.enableRunButtons) {
        setTimeout(() => {
          initializeRunButtons(this.$el, this.runButtonContext);
        }, 10);
      }
    },
    baseUrl: function(newBaseUrl) {
      this.baseUrl = newBaseUrl;

      this.docs = DOMPurify.sanitize(
        replaceAllRelByAbs(marked(this.content), this.baseUrl),
        dompurifyConfig
      );
    },
    url: function(newUrl) {
      if (!newUrl) return;
      this.showDocsUrl(newUrl);
    }
  },
  mounted() {
    marked.setOptions({
      baseUrl: this.baseUrl
    });
    if (this.content)
      this.docs = DOMPurify.sanitize(
        replaceAllRelByAbs(marked(this.content), this.baseUrl),
        dompurifyConfig
      );
    else if (this.url) {
      this.showDocsUrl(this.url);
    }
  },
  methods: {
    async showDocsUrl(url) {
      this.loading = true;
      this.docs = "@loading...";
      try {
        const response = await fetch(url);
        if (response.status == 200) {
          const content = await response.text();
          if (url.endsWith(".md")) {
            const temp = url.split("/");
            const baseUrl = temp.slice(0, temp.length - 1).join("/");

            this.docs = DOMPurify.sanitize(
              replaceAllRelByAbs(marked(content), baseUrl),
              dompurifyConfig
            );
            this.loading = false;
          } else {
            this.docs = DOMPurify.sanitize(
              marked("```\n" + content + "\n```\n"),
              dompurifyConfig
            );
          }
        } else {
          this.docs = "Oops! Failed to load from " + url;
        }
      } catch (e) {
        this.docs = "Oops! Failed to load from " + url;
      } finally {
        this.loading = false;
      }
    }
  }
};
</script>
<style scoped></style>
