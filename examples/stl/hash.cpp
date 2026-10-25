#include <iostream>
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
}
