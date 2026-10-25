"""Build the searchable STL supplement and verify every new standalone example."""
from pathlib import Path
import json, subprocess, tempfile

root = Path(__file__).resolve().parents[1]
groups = []
def add(key, title, header, intro, rows, code, output, exercise, standard='c++11', source='https://eel.is/c++draft/algorithms'):
    groups.append(dict(key=key,title=title,header=header,intro=intro,rows=rows,code=code,output=output,exercise=exercise,standard=standard,source=source))

add('iterators','迭代器与输出适配：位置、距离和追加','<iterator>',
    '迭代器代表位置，末尾位置不能解引用。advance修改原位置，next和prev返回新位置。vector迭代器支持常数时间跳转；list的跳转需要逐步移动。负向移动要求双向迭代器，不能越过合法边界。back_inserter把写入转换为push_back，省去预先创建结果元素。',[
    ['advance','advance(it,n)','void，修改it','随机访问O(1)，其他O(|n|)','负n要求双向迭代器；不能越界'],
    ['next / prev','next(it,n) / prev(it,n)','新迭代器，原it不变','随机访问O(1)，其他O(|n|)','prev要求双向；不要对begin继续向前'],
    ['distance','distance(first,last)','有符号difference_type','随机访问O(1)，其他O(n)','位置须可达；list上不是常数时间'],
    ['rbegin / rend','v.rbegin() / v.rend()','反向迭代器','O(1)','rend不能读；反向遍历与普通下标不同'],
    ['back_inserter','back_inserter(v)','输出迭代器','每次写入调用push_back','目标需支持push_back；与预留容量reserve不同']
    ],r'''#include <iostream>
#include <vector>
#include <iterator>
#include <algorithm>
int main() {
    std::vector<int> v{2,4,6}, out;
    std::vector<int>::iterator it=v.begin();
    std::advance(it,1);
    std::cout<<*it<<' '<<*std::prev(v.end())<<' '<<std::distance(v.begin(),v.end())<<' '<<*v.rbegin()<<'\n';
    std::copy(v.begin(),v.end(),std::back_inserter(out));
    for(std::size_t i=0;i<out.size();++i)std::cout<<(i?" ":"")<<out[i];
    std::cout<<'\n';
}''','4 6 3 6\n2 4 6\n','把advance步数改为2，第一行应为6 6 3 6；对空vector只检查begin==end，不读取末尾。',source='https://eel.is/c++draft/iterator.operations')

add('multi','multimap与重复键：数量、范围和删除','<map>、<set>',
    'map/set唯一键，multimap/multiset允许等价键。multimap没有operator[]；使用insert或emplace加入一对键和值。equal_range给出该键的左闭右开范围。erase(key)删除所有等价键，erase(iterator)只删一个已定位元素。',[
    ['multimap::insert','m.insert(make_pair(k,v))','新元素迭代器','O(log n)','同键不覆盖，multimap没有[]'],
    ['equal_range','m.equal_range(k)','pair<iterator,iterator>','定位O(log n)，遍历另加O(k)','不匹配时两个位置相同'],
    ['multiset::erase(key)','s.erase(k)','删除数量size_type','O(log n + 删除数量)','所有同值元素都会删除'],
    ['multiset::erase(iterator)','s.erase(it)','后继迭代器（C++11起）','均摊O(1)','先确认it!=end；只删一个'],
    ['multimap::count','m.count(k)','等价键数量','O(log n + 数量)','重复键数量可大于1']
    ],r'''#include <iostream>
#include <map>
#include <set>
#include <string>
int main(){
 std::multimap<int,std::string> m;
 m.insert(std::make_pair(2,"b"));m.insert(std::make_pair(2,"c"));m.insert(std::make_pair(1,"a"));
 std::pair<std::multimap<int,std::string>::iterator,std::multimap<int,std::string>::iterator> range=m.equal_range(2);
 int count=0;for(std::multimap<int,std::string>::iterator it=range.first;it!=range.second;++it)++count;
 std::cout<<count<<' '<<m.count(2)<<'\n';
 std::cout<<m.erase(2)<<' '<<m.size()<<'\n';
 std::multiset<int> s{1,1,2};std::multiset<int>::iterator it=s.find(1);
 if(it!=s.end())s.erase(it);
 std::cout<<s.size()<<' '<<s.count(1)<<'\n';
}''','2 2\n2 1\n2 1\n','把最后erase(it)改为erase(1)，最后一行变为1 0；说明一次删一个与一次删同键全部的区别。',source='https://eel.is/c++draft/associative.reqmts')

add('hash','无序容器补全：多重键、容量与失效','<unordered_map>、<unordered_set>',
    '四种无序关联容器是unordered_map、unordered_set、unordered_multimap、unordered_multiset。它们不维护数值升序，遍历顺序不应用作答案顺序。查找平均常数、最坏线性；多重键的匹配数量另计。reserve/rehash可能让所有迭代器失效，未被删除元素的引用与指针仍有效。先设max_load_factor，再reserve预计元素数。桶数量由实现决定，不编写依赖固定桶数的输出。',[
    ['unordered_multiset','unordered_multiset<int> s','允许重复键的容器','查找平均O(1)，最坏O(n)','无序；count(k)还与匹配数量有关'],
    ['unordered_multimap','unordered_multimap<K,V> m','允许重复键的映射','查找平均O(1)，最坏O(n)','没有operator[]，用insert/emplace'],
    ['reserve / rehash','m.reserve(n) / m.rehash(b)','void','平均O(n)，最坏O(n²)','分别按元素数量/桶数请求；可能使迭代器失效'],
    ['load_factor','m.load_factor()','float，元素数/桶数','O(1)','不是冲突数，也不是正确率'],
    ['max_load_factor','m.max_load_factor(z)','设置版本返回void','设置O(1)','z为正；控制最大装载因子，不保证无冲突'],
    ['bucket_count','m.bucket_count()','桶数size_type','O(1)','具体桶数与实现有关'],
    ['unordered_map::at','m.at(k)','映射值引用','平均O(1)，最坏O(n)','不存在抛out_of_range；[]会插入缺失键']
    ],r'''#include <iostream>
#include <unordered_set>
#include <unordered_map>
int main(){
 std::unordered_multiset<int> s{2,2,5};
 std::cout<<s.size()<<' '<<s.count(2)<<'\n';
 std::unordered_multiset<int>::iterator it=s.find(2);if(it!=s.end())s.erase(it);
 std::cout<<s.size()<<' '<<s.count(2)<<'\n';
 std::unordered_map<int,int> m;m.max_load_factor(0.7f);m.reserve(32);m[4]=7;
 std::cout<<m.at(4)<<' '<<m.count(99)<<' '<<m.size()<<'\n';
 std::unordered_multimap<int,int> pairs;pairs.emplace(3,8);pairs.emplace(3,9);
 std::cout<<pairs.count(3)<<'\n';
}''','3 2\n2 1\n7 0 1\n2\n','把count(99)改为访问m[99]后再输出size：size会增加；访问前先find才不会插入。',source='https://eel.is/c++draft/unord.req')

add('setops','有序集合运算：并、交、差与包含','<algorithm>、<iterator>',
    '这些算法操作有序区间，不是set容器专用。两个输入必须按同一比较规则排序，输出空间必须足够或使用back_inserter。重复次数按多重集合语义：并取最大次数，交取最小次数，差取非负次数差；不是自动去重。输出不能与输入重叠。',[
    ['set_union','set_union(a,b,out)（简写）','输出末尾迭代器','O(n+m)','次数取两边最大值'],
    ['set_intersection','set_intersection(a,b,out)（简写）','输出末尾迭代器','O(n+m)','次数取两边最小值'],
    ['set_difference','set_difference(a,b,out)（简写）','输出末尾迭代器','O(n+m)','方向有意义：A减B'],
    ['set_symmetric_difference','set_symmetric_difference(a,b,out)（简写）','输出末尾迭代器','O(n+m)','次数为两边次数差的绝对值'],
    ['includes','includes(a.begin(),a.end(),b.begin(),b.end())','bool','O(n+m)','检查B是否被A包含，重复数量也须足够']
    ],r'''#include <iostream>
#include <vector>
#include <algorithm>
#include <iterator>
void print(const std::vector<int>& v){for(std::size_t i=0;i<v.size();++i)std::cout<<(i?" ":"")<<v[i];std::cout<<'\n';}
int main(){
 std::vector<int> a{1,2,2,4},b{2,3},out;
 std::set_union(a.begin(),a.end(),b.begin(),b.end(),std::back_inserter(out));print(out);out.clear();
 std::set_intersection(a.begin(),a.end(),b.begin(),b.end(),std::back_inserter(out));print(out);out.clear();
 std::set_difference(a.begin(),a.end(),b.begin(),b.end(),std::back_inserter(out));print(out);out.clear();
 std::set_symmetric_difference(a.begin(),a.end(),b.begin(),b.end(),std::back_inserter(out));print(out);
 std::cout<<std::includes(a.begin(),a.end(),b.begin(),b.end())<<'\n';
}''','1 2 2 3 4\n2\n1 2 4\n1 2 3 4\n0\n','将b改为{2,2}：并为1 2 2 4，交为2 2，A减B为1 4，包含检查为1。',source='https://eel.is/c++draft/alg.set.operations')

add('heap','堆算法：建堆、加入、弹出与排序','<algorithm>',
    '默认比较规则建立最大堆。make_heap整理已有区间；push_heap前应先把新值追加在末尾，前n-1个元素已经是堆。pop_heap只把最大值移到末尾并维护前缀堆，不会缩短容器，之后才pop_back。sort_heap把堆排为升序，排序后通常已不再是最大堆。比较器必须前后一致。',[
    ['make_heap','make_heap(first,last)','void','O(n)','需要随机访问迭代器'],
    ['push_heap','push_heap(first,last)','void','O(log n)','前n-1项已是堆；先push_back再调用'],
    ['pop_heap','pop_heap(first,last)','void','O(log n)','非空堆；不删除最后元素'],
    ['sort_heap','sort_heap(first,last)','void','O(n log n)','输入已经是堆'],
    ['is_heap','is_heap(first,last)','bool','O(n)','检查，不修改区间']
    ],r'''#include <iostream>
#include <vector>
#include <algorithm>
int main(){
 std::vector<int> v{3,1,4};std::make_heap(v.begin(),v.end());std::cout<<v.front()<<'\n';
 v.push_back(5);std::push_heap(v.begin(),v.end());std::cout<<v.front()<<'\n';
 std::pop_heap(v.begin(),v.end());std::cout<<v.back()<<'\n';v.pop_back();
 std::sort_heap(v.begin(),v.end());for(std::size_t i=0;i<v.size();++i)std::cout<<(i?" ":"")<<v[i];std::cout<<'\n';
 std::cout<<std::is_heap(v.begin(),v.end())<<'\n';
}''','4\n5\n5\n1 3 4\n0\n','在pop_heap之后、pop_back之前检查v.size()，仍为4；再次建堆后front为4。',source='https://eel.is/c++draft/alg.heap.operations')

add('numeric','numeric补全：前缀累计、相邻差与内积','<numeric>',
    'accumulate的初值类型决定累计类型；整数和可能较大时用0LL。partial_sum输出包含当前项的前缀累计，结果默认使用输入值类型参与累计，必要时先用long long容器。adjacent_difference第一个值原样复制，之后输出相邻差。inner_product按位置相乘并累计，第二个区间至少与第一个等长。',[
    ['partial_sum','partial_sum(first,last,out)','输出末尾迭代器','O(n)','输出空间足够；注意输入值类型溢出'],
    ['adjacent_difference','adjacent_difference(first,last,out)','输出末尾迭代器','O(n)','第一项不是与0之外某个额外项做差'],
    ['inner_product','inner_product(a.begin(),a.end(),b.begin(),0LL)','累计值','O(n)','第二段长度足够；乘法本身也不能溢出'],
    ['iota','iota(first,last,start)','void','O(n)','逐个递增填充，不会扩容'],
    ['accumulate','accumulate(first,last,0LL)','long long','O(n)','只将结果接到long long并不能修复int初值溢出']
    ],r'''#include <iostream>
#include <vector>
#include <numeric>
void print(const std::vector<long long>& v){for(std::size_t i=0;i<v.size();++i)std::cout<<(i?" ":"")<<v[i];std::cout<<'\n';}
int main(){
 std::vector<long long> a{2,3,5},prefix(3),difference(3);
 std::partial_sum(a.begin(),a.end(),prefix.begin());print(prefix);
 std::adjacent_difference(prefix.begin(),prefix.end(),difference.begin());print(difference);
 std::cout<<std::inner_product(a.begin(),a.end(),a.begin(),0LL)<<' '<<std::accumulate(a.begin(),a.end(),0LL)<<'\n';
}''','2 5 10\n2 3 5\n38 10\n','把a改为{1,4,2}，累计为1 5 7，差分恢复1 4 2，内积21、总和7。',source='https://eel.is/c++draft/numeric.ops')

add('sequence','序列算法补全：旋转、稳定分区与比较','<algorithm>',
    'rotate把[first,middle)移到后面，范围长度不变。stable_partition把条件为真的元素放前面并保留各组内部顺序；partition不保证稳定。remove_if只改变有效前缀并返回新末尾，不缩短vector，要配合erase。mismatch返回首个不匹配位置对；C++11三迭代器版本要求第二段足够长。',[
    ['rotate','rotate(first,middle,last)','原first的新位置','O(n)','middle可以等于首尾；不是排序'],
    ['partition','partition(first,last,pred)','后半段起点','O(n)谓词调用','原地重排但不稳定'],
    ['stable_partition','stable_partition(first,last,pred)','后半段起点','O(n)谓词；交换O(n)有缓冲，否则O(n log n)','两组内保序，可能分配临时空间'],
    ['transform','transform(first,last,out,func)','输出末尾迭代器','O(n)','目标空间足够；不自动push_back'],
    ['remove_if','remove_if(first,last,pred)','新的逻辑末尾','O(n)','需要容器erase才真正缩短'],
    ['mismatch','mismatch(a.begin(),a.end(),b.begin())','两个首个不匹配位置','O(n)','无不匹配时返回对应末尾，不可读取'],
    ['lexicographical_compare','lexicographical_compare(a.begin(),a.end(),b.begin(),b.end())','bool','O(min(n,m))','字典序不等于数字串的数值大小']
    ],r'''#include <iostream>
#include <vector>
#include <algorithm>
bool even(int x){return x%2==0;}bool odd(int x){return x%2!=0;}int square(int x){return x*x;}
void print(const std::vector<int>& v){for(std::size_t i=0;i<v.size();++i)std::cout<<(i?" ":"")<<v[i];std::cout<<'\n';}
int main(){
 std::vector<int> v{1,2,3,4};std::rotate(v.begin(),v.begin()+1,v.end());print(v);
 std::vector<int>::iterator mid=std::stable_partition(v.begin(),v.end(),even);print(v);std::cout<<(mid-v.begin())<<'\n';
 std::vector<int> out(v.size());std::transform(v.begin(),v.end(),out.begin(),square);print(out);
 v.erase(std::remove_if(v.begin(),v.end(),odd),v.end());print(v);
 int a[]={1,2,3},b[]={1,4,3};std::pair<int*,int*> p=std::mismatch(a,a+3,b);
 std::cout<<(p.first-a)<<' '<<std::lexicographical_compare(a,a+3,b,b+3)<<'\n';
}''','2 3 4 1\n2 4 3 1\n2\n4 16 9 1\n2 4\n1 1\n','把remove_if的odd改为even，留下3 1；先看返回位置，不访问被erase删除的旧元素。',source='https://eel.is/c++draft/alg.modifying.operations')

add('versions','C++17扩展：条件插入、节点转移和gcd','<map>、<numeric>、<limits>',
    '本节明确需要C++17，不要求当前课程立即掌握。try_emplace在键存在时保留旧值；insert_or_assign存在时赋新值，两者返回pair<iterator,bool>，bool表示是否插入新键。extract取出节点，节点持有元素，可改key再插入；merge只转移目标能接收的键，冲突项留在源容器，分配器须兼容。gcd/lcm作用于整数，结果必须可表示。',[
    ['try_emplace','m.try_emplace(key,args...)','pair<iterator,bool>','map O(log n)','键存在不覆盖值'],
    ['insert_or_assign','m.insert_or_assign(key,value)','pair<iterator,bool>','map O(log n)','bool为是否新插入，不是是否修改'],
    ['extract','m.extract(key)','node_type节点句柄','按键O(log n)','节点可能为空；使用前检查'],
    ['merge','target.merge(source)','void','map总量O(n log(size+n))上界','同键留在源，分配器须兼容'],
    ['gcd / lcm','gcd(a,b) / lcm(a,b)','共同整数类型的结果','gcd通常O(log min(|a|,|b|))','绝对值与lcm结果须能表示；lcm含0返回0'],
    ['numeric_limits','numeric_limits<T>::digits','编译期值','O(1)','此例检查有效值位数，不硬编码平台字节数']
    ],r'''#include <iostream>
#include <map>
#include <string>
#include <numeric>
#include <limits>
int main(){
 std::map<int,std::string> m;m.emplace(1,"one");
 std::pair<std::map<int,std::string>::iterator,bool> a=m.try_emplace(1,"ignored"),b=m.insert_or_assign(1,"uno");
 std::cout<<a.second<<' '<<b.second<<' '<<m.at(1)<<'\n';
 std::map<int,std::string>::node_type node=m.extract(1);if(!node.empty()){node.key()=3;m.insert(std::move(node));}
 std::map<int,std::string> other{{3,"tres"},{4,"four"}};m.merge(other);
 std::cout<<m.size()<<' '<<other.size()<<' '<<m.at(3)<<'\n';
 std::cout<<std::gcd(18,24)<<' '<<std::lcm(18,24)<<' '<<(std::numeric_limits<long long>::digits>=63)<<'\n';
}''','0 0 uno\n2 1 uno\n6 72 1\n','把try_emplace键改为2，a.second为1；merge后只转入没有冲突的4。numeric_limits是相关标准库工具，不把整个标准库等同STL。',standard='c++17',source='https://learn.microsoft.com/en-us/cpp/standard-library/map-class?view=msvc-170')

core = [
('vector','stl-2','<vector>','push_back|末尾追加，void，均摊O(1)，扩容单次O(n)|pop_back|删除末项，void，O(1)，要求非空|size / empty|长度/是否为空，O(1)|resize|调整已有元素数量，保留前缀，新int值初始化|reserve|仅预留容量，不改变size；扩容使旧位置失效|assign|整体替换，不是追加|at / operator[]|访问已有元素；at检查并抛异常，[]不检查|erase / insert|移动后续元素，vector通常O(n)|data / capacity|首元素地址/已分配容量；capacity不是可访问长度'),
('string','stl-3','<string>','find / rfind|找子串，未找到返回npos|substr|按起点与数量复制新串，pos==size合法|compare|字典序比较返回负/零/正，不限于-1/0/1|append / +=|追加字符或字符串，可能重新分配|insert / erase / replace|按位置修改内容，注意有效区间|size / length|字符元素数量，O(1)，不是中文字符数|c_str|只读零结尾字符指针；修改可能失效|getline|读取一行，注意前一次格式输入留下的换行'),
('pair / tuple','stl-4','<utility>、<tuple>','make_pair / pair|组合两个值，first/second访问|make_tuple / get|组合多个值，get下标须编译期确定|tie|把已有变量绑定到引用tuple，不能引用临时对象'),
('排序与选择','stl-5','<algorithm>','sort|随机访问区间，O(n log n)，不稳定|stable_sort|稳定排序，有足够额外空间O(n log n)，否则O(n log² n)|min / max|两个同类型值比较，返回const引用，避免引用临时量|min_element / max_element|扫描返回首个极值位置，空区间返回last'),
('去重与二分','stl-6','<algorithm>','unique|只压缩相邻等价元素，返回新末尾，不缩容|lower_bound / upper_bound|有序随机访问区间定位边界O(log n)，可能返回end|binary_search|有序区间判断存在，返回bool|equal_range|返回匹配区间边界对；容器成员版更适合树容器'),
('扫描与填充','stl-7','<algorithm>、<numeric>','find / find_if|找首个匹配位置，最坏O(n)，失败返回last|count / count_if|扫描O(n)，返回difference_type数量|copy / copy_if|复制到已准备的目标或插入迭代器|fill / fill_n|覆盖已有目标元素，不扩容|all_of / any_of / none_of|条件全部/存在/均不满足；空区间依次true/false/true'),
('stack','stl-8','<stack>','push / emplace|新增栈顶，默认底层deque下常数|top|栈顶引用，要求非空|pop|删除栈顶，无返回值，要求非空|empty / size|空值与长度检查，不提供普通遍历接口'),
('queue / deque','stl-9','<queue>、<deque>','queue::push / pop|队尾进入、队首删除；pop无返回|queue::front / back|队首/队尾引用，要求非空|deque::push_front / push_back|两端新增，常数时间|deque::pop_front / pop_back|两端删除，要求非空|deque::operator[]|随机访问O(1)，内存不保证整体连续'),
('priority_queue','stl-10','<queue>、<functional>','top|默认最大元素的const引用，O(1)，非空|push / emplace|堆维护O(log n)，底层扩容另计|pop|删除优先元素，O(log n)，无返回值|greater比较器|建立最小堆；自定义比较必须严格弱序'),
('map / unordered_map','stl-11','<map>、<unordered_map>','map::find / count|按键查找O(log n)，不新增键|map::operator[]|缺失键会插入默认值，查询时慎用|map::lower_bound / upper_bound|树容器成员查询O(log n)|unordered_map::find|平均O(1)，最坏O(n)，不支持有序边界'),
('set / multiset','stl-12','<set>','insert / emplace|set去重，multiset保留同键；O(log n)|find / lower_bound|按比较器定位，成员O(log n)|erase(key) / erase(it)|按键删全部同键/按位置删一个，勿解引用end'),
('array / list / forward_list','stl-13','<array>、<list>、<forward_list>','array::fill / at|固定长度数组填充或检查访问|list::splice|兼容分配器间转移节点；整表/单节点O(1)，跨表区间可O(n)|list::sort / unique|链表成员排序/相邻去重，不用std::sort|forward_list::before_begin|首节点前的位置，不可解引用|insert_after / erase_after|在已知前驱后插入/删除，使用有效前驱'),
('排列与部分排序','stl-14','<algorithm>','next_permutation / prev_permutation|下/上一个字典序排列，bool表示是否找到；末端回绕|partial_sort|前k项排序，O(n log k)，不保证后部有序|nth_element|第k位置与全排序同值，平均O(n)，左右各自不保证有序'),
('bitset','stl-15','<bitset>','set / reset / flip|置1/清0/翻转，可作用整体或指定合法位置|test / operator[]|test检查范围；[]要求合法下标|count / any / all / none|1的数量及布尔判定，成本取决于位数/实现|to_string / to_ullong|转字符串或整数，整数不能表示时抛overflow_error')]

catalog=[]
for category,guide,header,pairs in core:
    words=pairs.split('|')
    for i in range(0,len(words),2):
        catalog.append(dict(id=f'{guide}-api-{i//2}',name=words[i],category=category,header=header,version='C++11',signature='参见关联讲义中的完整调用',returns='按下方语义区分；详见讲义',complexity=words[i+1],boundary='区间默认左闭右开；空值、失效与具体重载见关联讲义',guideId=guide))

documents=[]; examples=root/'examples'/'stl';examples.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory() as directory:
    for group in groups:
        key=group['key'];standard=group['standard'];code=group['code']+'\n';path=examples/(key+'.cpp');path.write_text(code)
        binary=Path(directory)/key
        subprocess.run(['g++','-std='+standard,'-Wall','-Wextra','-pedantic',str(path),'-o',str(binary)],check=True,capture_output=True)
        actual=subprocess.check_output([str(binary)],text=True)
        assert actual==group['output'],(key,actual,group['output'])
        guide='stl-extra-'+key
        version='C++17' if standard=='c++17' else 'C++11'
        for i,row in enumerate(group['rows']):
            catalog.append(dict(id=guide+'-api-'+str(i),name=row[0],category=group['title'],header=group['header'],version=version,signature=row[1],returns=row[2],complexity=row[3],boundary=row[4],guideId=guide))
        table='|接口|调用（完整参数见代码）|返回|时间复杂度|条件与边界|\n|---|---|---|---|---|\n'+'\n'.join('|'+ '|'.join(('`'+cell+'`') if i==1 else cell for i,cell in enumerate(row))+'|' for row in group['rows'])
        body=f"## 使用定位\n\n{group['intro']}\n\n适用标准：{version}。头文件：`{group['header']}`。这是通用工具补充，不是当天正式题解；扩展条目列入参考不表示已经学过。\n\n## 接口速查\n\n{table}\n\n## 完整可运行示例\n\n```cpp\n{code}```\n\n## 实际运行输出\n\n```text\n{group['output']}```\n\n代码已用g++ -std={standard} -Wall -Wextra -pedantic编译并逐字核对输出。示例数据为教学自拟。输出空间由示例中的容器实际分配；复杂度默认单个元素操作为常数，不包含大字符串比较等额外成本。\n\n## 短操作与核对\n\n{group['exercise']}\n\n短操作可作为工具准备，不增加完整必做题。只有实际练习反馈才记录应用证据。\n\n## 来源与核验\n\n核验日期：2026-10-23。[标准草案或实现官方说明]({group['source']})。草案是当前草案；本文仅选取上述标准可用的经典重载，未将ranges等新接口混入C++11。\n"
        documents.append(dict(id=guide,title=group['title'],kind='STL专题',body=body,version=version))

(root/'content'/'stl-reference.json').write_text(json.dumps(dict(items=catalog,docs=documents,verifiedAt='2026-10-23'),ensure_ascii=False,indent=2)+'\n')
print(f'{len(catalog)} searchable API entries; {len(documents)} supplement programs compiled and output-verified')
